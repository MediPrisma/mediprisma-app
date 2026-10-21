"use client"

import { useCallback, useEffect, useRef, useState, memo, type ReactNode } from "react"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/src/shared/utils/cn.utils"
import { useLanguage } from "@/src/application/providers/language.provider"
import { isCustomOpenAiModelId } from "@/src/shared/constants/ai-models.constants"
import { MarkdownRenderer } from "@/src/shared/components/MarkdownRenderer"
import { StreamingIndicator } from "@/src/shared/components/StreamingIndicator"
import { useCopyToClipboard } from "@/src/shared/hooks/use-copy-to-clipboard"
import { markdownToPlainText } from "@/src/shared/utils/markdown-to-text"
import { modelDisplayLabel } from "@/src/shared/utils/model-access.utils"
import type { ChatDataScope, ChatMessage, ChatReplyReference } from "@/src/application/stores/chat.store"
import { createReplyReference } from "@/src/shared/utils/chat-message.utils"
import { AgentStateHistory } from "./AgentStateHistory"
import { CollapsibleMessage } from "./CollapsibleMessage"
import { ModelExecutionInfo, ModelExecutionNotice } from '@/src/shared/components/ModelExecutionNotice'
import { modelExecutionLabel } from '@/src/shared/utils/ai-model-execution'
import { AlertTriangle, Check, Copy, Reply, RotateCcw, Sparkles } from "lucide-react"

interface ChatMessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  /** Local OpenAI-compatible models receive a fixed clinical snapshot and do
   * not have access to the Agent's FHIR or literature tools. */
  isStandardChatMode?: boolean
  dataScope?: ChatDataScope
  /** Rendered at the very bottom of the thread, under the last message (e.g. the
   *  follow-up suggestion chips) — so it scrolls with the conversation like ChatGPT. */
  afterMessages?: ReactNode
  /** Bump to re-trigger the auto-scroll when `afterMessages` content appears/changes
   *  (the [messages] effect alone won't fire, since messages didn't change). */
  scrollSignal?: number
  onReplyToSelection?: (reply: ChatReplyReference) => void
  /** Sanitized logical-id → upstream-name mapping. Endpoint URLs and API keys
   * never need to enter this presentation component. */
  customModelDisplayNames?: Readonly<Record<string, string>>
  /** Replay the failed turn. Rendered next to the error on a failed message. */
  onRetry?: () => void
}

function getModelDisplayName(
  modelId?: string,
  customModelDisplayNames?: Readonly<Record<string, string>>,
): string {
  if (!modelId) return "AI"
  const customName = customModelDisplayNames?.[modelId]?.trim()
  return customName || modelDisplayLabel(modelId)
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  
  const timeStr = date.toLocaleTimeString('zh-TW', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  })
  
  if (isToday) {
    return timeStr
  }
  
  const dateStr = date.toLocaleDateString('zh-TW', { 
    month: '2-digit', 
    day: '2-digit' 
  })
  return `${dateStr} ${timeStr}`
}

interface SelectionAction {
  reply: ChatReplyReference
  x: number
  y: number
}

const MessageItem = memo(function MessageItem({
  message,
  t,
  modelDisplayName,
  onReplyToSelection,
  replyDisabled,
  onRetry,
}: {
  message: ChatMessage
  t: any
  modelDisplayName: string
  onReplyToSelection?: (reply: ChatReplyReference) => void
  replyDisabled?: boolean
  onRetry?: () => void
}) {
  const { copied, copy } = useCopyToClipboard()
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null)

  const handleCopy = async () => {
    const ok = await copy(markdownToPlainText(message.content))
    if (!ok) toast.error(t.common.copyFailed)
  }

  const updateSelectionAction = useCallback(() => {
    if (replyDisabled || message.role !== "assistant" || !onReplyToSelection || !bubbleRef.current) {
      setSelectionAction(null)
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionAction(null)
      return
    }

    const anchorInside = selection.anchorNode ? bubbleRef.current.contains(selection.anchorNode) : false
    const focusInside = selection.focusNode ? bubbleRef.current.contains(selection.focusNode) : false
    if (!anchorInside || !focusInside) {
      setSelectionAction(null)
      return
    }

    const selectedText = selection.toString()
    const reply = createReplyReference(message, selectedText, modelDisplayName)
    if (!reply) {
      setSelectionAction(null)
      return
    }

    const range = selection.getRangeAt(0)
    const selectionRect = range.getBoundingClientRect()
    const fallbackRect = bubbleRef.current.getBoundingClientRect()
    const rect = selectionRect.width > 0 || selectionRect.height > 0 ? selectionRect : fallbackRect
    const x = Math.min(Math.max(rect.left + rect.width / 2, 48), window.innerWidth - 48)
    const y = Math.max(8, rect.top - 38)

    setSelectionAction({ reply, x, y })
  }, [message, modelDisplayName, onReplyToSelection, replyDisabled])

  const handleSelectionEnd = useCallback(() => {
    window.setTimeout(updateSelectionAction, 0)
  }, [updateSelectionAction])

  useEffect(() => {
    if (!selectionAction) return
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionAction(null)
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [selectionAction])

  const handleReplyClick = () => {
    if (!selectionAction) return
    onReplyToSelection?.(selectionAction.reply)
    setSelectionAction(null)
    window.getSelection()?.removeAllRanges()
  }

  // A turn that failed before producing any text has nothing to put in a
  // bubble — render only the error banner instead of an empty one. A turn
  // that failed mid-answer keeps its bubble, with the banner underneath.
  const showBubble = message.role !== "assistant"
    || !!message.content
    || !message.error

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        message.role === "assistant" ? "items-start" : "items-end",
      )}
    >
      <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground px-1">
        <span className={cn(
          "min-w-0 max-w-[60vw] truncate font-medium tracking-wide sm:max-w-96",
          !isCustomOpenAiModelId(message.modelExecution?.routedModelId ?? message.modelId ?? '') && "uppercase",
        )} title={message.role === 'assistant' ? modelDisplayName : undefined}>
          {message.role === "assistant" 
            ? modelDisplayName
            : message.role === "user" 
            ? t.chat.you
            : t.chat.system}
        </span>
        {message.role === "assistant" && <ModelExecutionInfo execution={message.modelExecution} />}
        {message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0 && (
          <>
            <span>•</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              <span className="font-medium">
                {message.toolCalls.includes('searchMedicalLiterature') ? 'Perplexity' : 'FHIR'}
              </span>
            </span>
          </>
        )}
        <span>•</span>
        <span>{formatTimestamp(message.timestamp)}</span>
      </div>
      <div className="flex flex-col gap-2 max-w-[92%] sm:max-w-[85%]">
        {message.role === "assistant" && (!replyDisabled || message.modelExecution?.actualModelId) && (
          <ModelExecutionNotice execution={message.modelExecution} />
        )}
        {message.role === "assistant" && message.agentStates && message.agentStates.length > 1 && (
          <AgentStateHistory 
            states={message.agentStates} 
            currentState={message.content}
          />
        )}
        {showBubble && (
        <div
          ref={bubbleRef}
          onMouseUp={handleSelectionEnd}
          onTouchEnd={handleSelectionEnd}
          onKeyUp={handleSelectionEnd}
          className={cn(
            "relative px-4 py-2.5 text-sm break-words",
            message.role === "assistant" 
              ? "rounded-lg bg-transparent px-0.5 text-foreground"
              : "rounded-lg bg-foreground/[0.07] text-foreground",
          )}
        >
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.images.map((image, idx) => (
                <div
                  key={idx}
                  className="relative rounded-lg overflow-hidden border border-border"
                  style={{ maxWidth: '200px', maxHeight: '200px' }}
                >
                  <img
                    src={image.thumbnail || image.data}
                    alt={image.fileName || `Image ${idx + 1}`}
                    className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => {
                      // DOM APIs instead of document.write — no HTML-string
                      // interpolation in an app-origin window
                      const win = window.open('about:blank')
                      if (win) {
                        const img = win.document.createElement('img')
                        img.src = image.data
                        img.style.maxWidth = '100%'
                        img.style.height = 'auto'
                        win.document.body.style.margin = '0'
                        win.document.body.style.background = '#000'
                        win.document.body.appendChild(img)
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          {message.replyTo && (
            <div
              className={cn(
                "mb-2 rounded-md border px-2 py-1.5 text-xs leading-snug",
                message.role === "user"
                  ? "border-border/70 bg-background/60 text-muted-foreground"
                  : "border-border/70 bg-background/60 text-muted-foreground",
              )}
            >
              <div className={cn("mb-0.5 font-medium", "text-foreground")}>
                {(t.chat as any).replyingTo ?? 'Replying to'} {message.replyTo.label}
              </div>
              <div className="max-h-[2.5rem] overflow-hidden opacity-90">
                {message.replyTo.excerpt}
              </div>
            </div>
          )}
          {message.role === "assistant" ? (
            // MarkdownRenderer renders block-by-block and memoizes each block,
            // so while a reply streams in only the trailing (growing) block is
            // re-parsed — keeping live formatting without freezing the UI on
            // long/fast responses.
            <MarkdownRenderer content={message.content} />
          ) : (
            <CollapsibleMessage content={message.content} />
          )}
          {selectionAction && !replyDisabled && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleReplyClick}
              className="fixed z-50 inline-flex h-8 items-center gap-1 rounded-full border border-border bg-popover px-3 text-xs font-medium text-popover-foreground shadow-lg transition-colors hover:bg-accent"
              style={{
                left: selectionAction.x,
                top: selectionAction.y,
                transform: 'translateX(-50%)',
              }}
            >
              <Reply className="h-3.5 w-3.5" />
              {(t.chat as any).reply ?? 'Reply'}
            </button>
          )}
        </div>
        )}
        {message.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 self-start rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{message.error}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-destructive/40 px-2 font-medium transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                {t.errors.retry}
              </button>
            )}
          </div>
        )}
        {message.role === "assistant" && message.content && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? t.common.copied : t.common.copy}
            className="self-start flex items-center gap-1 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground/70 hover:text-foreground rounded transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-green-600 dark:text-green-300" />
                {t.common.copied}
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                {t.common.copy}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.message.id === nextProps.message.id &&
         prevProps.message.content === nextProps.message.content &&
         prevProps.message.error === nextProps.message.error &&
         prevProps.message.modelExecution === nextProps.message.modelExecution &&
         prevProps.modelDisplayName === nextProps.modelDisplayName &&
         prevProps.t === nextProps.t &&
         prevProps.onRetry === nextProps.onRetry &&
         prevProps.message.agentStates?.length === nextProps.message.agentStates?.length &&
         prevProps.message.replyTo?.messageId === nextProps.message.replyTo?.messageId &&
         prevProps.message.replyTo?.label === nextProps.message.replyTo?.label &&
         prevProps.message.replyTo?.excerpt === nextProps.message.replyTo?.excerpt &&
         prevProps.replyDisabled === nextProps.replyDisabled
})

export function ChatMessageList({
  messages,
  isLoading,
  isStandardChatMode = false,
  dataScope = 'patient',
  afterMessages,
  scrollSignal,
  onReplyToSelection,
  customModelDisplayNames,
  onRetry,
}: ChatMessageListProps) {
  const { t } = useLanguage()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const prevMessagesLengthRef = useRef(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll with debouncing to prevent blocking during fast streaming
  useEffect(() => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Debounce scroll updates during streaming (100ms)
    scrollTimeoutRef.current = setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
      }
    }, 100)

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [messages, scrollSignal])

  // Track message count for other purposes
  useEffect(() => {
    prevMessagesLengthRef.current = messages.length
  }, [messages.length])

  return (
    <ScrollArea className="h-full px-4 py-4">
      <div className="flex flex-col gap-4 min-h-full justify-end">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="max-w-md text-sm leading-relaxed text-muted-foreground">
              {dataScope === 'auto'
                ? t.chat.autoEmptyStateTitle
                : dataScope === 'general'
                ? t.chat.generalEmptyStateTitle
                : dataScope === 'patient-literature'
                  ? t.chat.patientLiteratureEmptyStateTitle
                  : isStandardChatMode
                    ? t.chat.localEmptyStateTitle
                    : t.chat.emptyStateTitle}
            </div>
            <div className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground/80">
              {dataScope === 'auto'
                ? t.chat.autoEmptyState
                : dataScope === 'general'
                ? t.chat.generalEmptyState
                : dataScope === 'patient-literature'
                  ? t.chat.patientLiteratureEmptyState
                  : isStandardChatMode
                    ? t.chat.localEmptyState
                    : t.chat.emptyState}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const execution = message.modelExecution
            const legacyCustomName = execution && !execution.actualModelId && !execution.customModelId
              ? customModelDisplayNames?.[execution.routedModelId] : undefined
            const modelDisplayName = execution
              ? legacyCustomName ?? modelExecutionLabel(execution)
              : getModelDisplayName(message.modelId, customModelDisplayNames)
            return (
              <MessageItem
                key={message.id}
                message={message}
                t={t}
                modelDisplayName={modelDisplayName}
                onReplyToSelection={onReplyToSelection}
                replyDisabled={isLoading}
                onRetry={message.error ? onRetry : undefined}
              />
            )
          })
        )}
        {isLoading ? (
          <StreamingIndicator label={t.common.loading} />
        ) : null}
        {afterMessages}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  )
}
