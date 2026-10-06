// Chat Input Area Component
"use client"

import { useId, useState } from "react"
import { Reply, Square, Zap, X } from "lucide-react"
import { Popover, PopoverAnchor } from "@/components/ui/popover"
import { useLanguage } from "@/src/application/providers/language.provider"
import { VoiceRecorder } from "./VoiceRecorder"
import { AudioWaveform } from "./AudioWaveform"
import { ImageUploadButton } from "./ImageUploadButton"
import { ImagePreview } from "./ImagePreview"
import { MediaConsentDialog } from "./MediaConsentDialog"
import { useMediaConsent } from "../hooks/useMediaConsent"
import type { ImageFile } from "../hooks/useImageUpload"
import { useSlashTemplates } from "../hooks/useSlashTemplates"
import { useSlashMenu } from "../hooks/useSlashMenu"
import { SlashTemplateMenu } from "./SlashTemplateMenu"
import type { ChatReplyReference } from "@/src/application/stores/chat.store"

interface ChatInputAreaProps {
  input: {
    input: string
    setInput: (value: string | ((prev: string) => string)) => void
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, handleSend: () => Promise<void>, isLoading?: boolean, disabled?: boolean) => void
  }
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  isLoading: boolean
  onSend: () => Promise<void>
  onStopGeneration: () => void
  voice: {
    isRecording: boolean
    isAsrLoading: boolean
    toggleRecording: () => void
    onRecordingStart: () => void
    onRecordingStop: (url: string, blob: Blob) => Promise<void>
    startRecordingRef: React.MutableRefObject<() => void>
    stopRecordingRef: React.MutableRefObject<() => void>
  }
  images?: {
    images: ImageFile[]
    isProcessing: boolean
    error: string | null
    addImages: (files: File[]) => Promise<void>
    removeImage: (index: number) => void
    clearError: () => void
  }
  disabled?: boolean
  /** Custom hospital endpoint: no owner proxy/history helper receives chat data. */
  isPrivateEndpoint?: boolean
  replyDraft?: ChatReplyReference | null
  onCancelReply?: () => void
}

export function ChatInputArea({
  input,
  textareaRef,
  isLoading,
  onSend,
  onStopGeneration,
  voice,
  images,
  disabled = false,
  isPrivateEndpoint = false,
  replyDraft,
  onCancelReply,
}: ChatInputAreaProps) {
  const { t } = useLanguage()
  // Live mic stream while recording — drives the waveform visualizer
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  // First-use consent before any image/audio leaves the device (audit B4)
  const consent = useMediaConsent()
  const hasContent = input.input.trim().length > 0

  // "/shortcut" template autocomplete (Epic SmartPhrase style).
  const slashTemplates = useSlashTemplates()
  const slash = useSlashMenu(input.input, input.setInput, textareaRef, slashTemplates)
  const slashMenuId = useId()
  const hasImages = images?.images && images.images.length > 0

  // Handle paste event for images
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!images) return
    
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      // Check if the item is an image
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault() // Prevent default paste behavior
      consent.withConsent(() => { void images.addImages(imageFiles) })
    }
  }

  return (
    <>
      <MediaConsentDialog
        open={consent.dialogOpen}
        onAccept={consent.accept}
        onCancel={consent.decline}
      />

      {/* Image Preview */}
      {images && images.images.length > 0 && (
        <ImagePreview
          images={images.images}
          onRemove={images.removeImage}
          disabled={isLoading}
        />
      )}

      {/* Error Display */}
      {images?.error && (
        <div className="text-xs text-destructive px-2 py-1 bg-red-50 dark:bg-rose-500/10 rounded border border-red-200 dark:border-rose-500/25">
          {images.error}
          <button
            onClick={images.clearError}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {replyDraft && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-900 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-100">
          <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-300" />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 font-medium">
              {(t.chat as any).replyingTo ?? 'Replying to'} {replyDraft.label}
            </div>
            <div className="max-h-[2.5rem] overflow-hidden leading-snug text-blue-800/80 dark:text-blue-100/75">
              {replyDraft.excerpt}
            </div>
          </div>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              aria-label={(t.chat as any).cancelReply ?? 'Cancel reply'}
              title={(t.chat as any).cancelReply ?? 'Cancel reply'}
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-blue-700/70 hover:bg-blue-100 hover:text-blue-900 dark:text-blue-100/70 dark:hover:bg-blue-500/15 dark:hover:text-blue-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex w-full gap-2 items-end">
        {/* Image Upload Button - positioned on the left */}
        {images && (
          <ImageUploadButton
            onFilesSelected={(files) => consent.withConsent(() => { void images.addImages(files) })}
            disabled={disabled || isLoading}
            isProcessing={images.isProcessing}
            multiple={true}
          />
        )}
        <Popover open={slash.open}>
          <PopoverAnchor asChild>
            <div className="relative flex flex-1 flex-col justify-end">
              <textarea
                ref={textareaRef}
                value={input.input}
                onChange={(event) => { input.setInput(event.target.value); slash.syncCaret() }}
                onKeyDown={(e) => { if (slash.onKeyDown(e)) return; input.handleKeyDown(e, onSend, isLoading, disabled) }}
                onSelect={() => slash.syncCaret()}
                onPaste={handlePaste}
                placeholder={t.chat.placeholder}
                spellCheck={false}
                rows={1}
                role="combobox"
                aria-haspopup="listbox"
                aria-autocomplete="list"
                aria-expanded={slash.open}
                aria-controls={slash.open ? slashMenuId : undefined}
                aria-activedescendant={slash.open ? `${slashMenuId}-option-${slash.active}` : undefined}
                className="w-full resize-none overflow-y-auto rounded-xl border-2 border-input bg-background/50 pl-4 pr-10 py-3 text-sm max-md:text-[16px] ring-offset-background placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-500/10 focus-visible:shadow-lg focus-visible:bg-background hover:border-input/80 hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200"
                style={{
                  minHeight: '44px',
                  // Keep a pasted clinical template from consuming the entire
                  // keyboard-reduced viewport. The text remains intact and
                  // scrollable; only the editor's visible height is capped.
                  maxHeight: 'min(200px, calc(var(--app-viewport-height, 100svh) * 0.16))',
                }}
              />
              {/* One-tap clear — handy on phones after accidentally tapping
                  "insert clinical context", which dumps a large block into the box. */}
              {input.input.length > 0 && !isLoading && !voice.isRecording && (
                <button
                  type="button"
                  onClick={() => { input.setInput(''); textareaRef.current?.focus() }}
                  aria-label={t.chat.clearInput}
                  title={t.chat.clearInput}
                  className="absolute top-2 right-2 flex h-7 w-7 max-md:h-[44px] max-md:w-[44px] items-center justify-center rounded-full bg-background/80 text-muted-foreground/70 touch-manipulation hover:bg-muted hover:text-foreground active:scale-95 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {/* While recording, overlay a live waveform over the textarea so the
                  user gets real-time feedback that the mic is picking up sound. */}
              {voice.isRecording && (
                <div className="absolute inset-0 flex items-center gap-3 rounded-xl border-2 border-primary/50 bg-background px-4">
                  <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <AudioWaveform stream={audioStream} className="min-w-0 flex-1" />
                </div>
              )}
            </div>
          </PopoverAnchor>
          {slash.open && (
            <SlashTemplateMenu
              id={slashMenuId}
              items={slash.matches}
              active={slash.active}
              onSelect={slash.choose}
              onHover={slash.setActive}
            />
          )}
        </Popover>
        <VoiceRecorder
          isRecording={voice.isRecording}
          isLoading={voice.isAsrLoading}
          onToggleRecording={() => {
            // Stopping an in-progress recording never needs a consent prompt
            if (voice.isRecording) voice.toggleRecording()
            else consent.withConsent(voice.toggleRecording)
          }}
          onRecordingStart={voice.onRecordingStart}
          onRecordingStop={voice.onRecordingStop}
          startRecordingRef={voice.startRecordingRef}
          stopRecordingRef={voice.stopRecordingRef}
          onStreamChange={setAudioStream}
          disabled={disabled}
        />
        {isLoading ? (
          <button
            onClick={onStopGeneration}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 px-4 py-2"
          >
            <Square className="h-4 w-4 fill-current" />
            {t.common.stop}
          </button>
        ) : (
          <button
            onClick={() => onSend()}
            disabled={!hasContent || isLoading || disabled}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            {t.common.send}
          </button>
        )}
      </div>
      <div
        data-keyboard-collapsible="true"
        className="flex flex-wrap items-center justify-between gap-2 text-[0.625rem] text-muted-foreground/70 [html[data-keyboard-open=true]_&]:hidden"
      >
        {/* Route-aware disclosure: the selected model decides the recipient. */}
        <span className="inline-flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {isPrivateEndpoint ? (
            t.chat.privateAiNotice
          ) : (
            <>
              {(t.chat as any).cloudAiNotice ?? 'AI 為雲端服務（OpenAI / Gemini）· 請勿輸入高度敏感個資'}
              {' · '}
              {/* Privacy policy lives on GitHub — single source of truth with
                  the markdown rendered there. */}
              <a
                href="https://github.com/MediPrisma/mediprisma-app/blob/master/PRIVACY_POLICY.md"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {(t.chat as any).cloudAiNoticeLink ?? '隱私說明'}
              </a>
            </>
          )}
        </span>
        {(input.input.length > 0 || hasImages) && (
          <span>
            {input.input.length} {t.chat.characters}
            {hasImages && ` • ${images!.images.length} image${images!.images.length > 1 ? 's' : ''}`}
          </span>
        )}
      </div>
    </>
  )
}
