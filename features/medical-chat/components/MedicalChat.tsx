// Refactored Medical Chat Component
"use client"

import { useAudience } from "@/src/application/providers/audience.provider"
import { useGalleryImport } from "@/features/prompt-gallery/hooks/useGalleryImport"
import { gallerySourceKey } from "@/src/shared/utils/gallery-template.utils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertCircle, Info, Maximize2, MessageSquareDashed, SquarePen, X } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAuth } from "@/src/application/providers/auth.provider"
import { useAiConfigStore } from "@/src/application/stores/ai-config.store"
import { useEffectiveModel, useModelPref, useSetModelFor, MODEL_PREF_DEFAULTS } from "@/src/application/stores/model-prefs.store"
import { ModelPicker } from "@/src/shared/components/ModelPicker"
import {
  useIsTemporaryMode,
  useSetIsTemporaryMode,
  useSetChatMessages,
  useChatDataScope,
  useSetChatDataScope,
  type ChatDataScope,
} from "@/src/application/stores/chat.store"
import { useSetCurrentSessionId } from "@/src/application/stores/chat-history.store"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ChatMessageList } from "./ChatMessageList"
import { ChatHeader } from "./ChatHeader"
import { ChatToolbar } from "./ChatToolbar"
import { ChatTemplatesManagerDrawer } from "./ChatTemplatesManagerDrawer"
import { ChatInputArea } from "./ChatInputArea"
import { SuggestionChips } from "./SuggestionChips"
import { ExpandedOverlay } from '@/src/shared/components/ExpandedOverlay'
import { trackEvent } from "@/src/application/telemetry/usage-analytics"
import { useAgentChat } from "../hooks/useAgentChat"
import { useFollowupSuggestions } from "../hooks/useFollowupSuggestions"
import { useVoiceRecording } from "../hooks/useVoiceRecording"
import { useTemplateSelector } from "../hooks/useTemplateSelector"
import { useChatInput } from "../hooks/useChatInput"
import { useSystemPrompt } from "../hooks/useSystemPrompt"
import { useImageUpload } from "../hooks/useImageUpload"
import { useRecordingStatus } from "../hooks/useRecordingStatus"
import { fileToBase64 } from "@/src/shared/utils/file-to-base64.utils"
import type { ChatImage, ChatReplyReference } from "@/src/application/stores/chat.store"
import { useExpandable } from "@/src/shared/hooks/ui/use-expandable.hook"
import { useTextareaAutoResize } from "../hooks/useTextareaAutoResize"
import { useApiKeyValidation } from "../hooks/useApiKeyValidation"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { useFhirContext } from "@/src/application/hooks/chat/use-fhir-context.hook"
import { useAutoSaveChat } from "@/src/application/hooks/chat/use-auto-save-chat.hook"
import { useSmartTitleGeneration } from "@/src/application/hooks/chat/use-smart-title-generation.hook"
import { ChatHistoryDrawer } from "@/features/chat-history"
import { usePatient } from "@/src/application/hooks/patient/use-patient-query.hook"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import { PromptGalleryDialog } from "@/features/prompt-gallery"
import type { PromptType, SharedPrompt } from "@/features/prompt-gallery"
import { useChatTemplates } from "@/src/application/providers/chat-templates.provider"
import { AuthDialog } from "@/features/auth"
import { isQuotaExceededError } from "@/src/core/errors"
import {
  customOpenAiModelIdForProfile,
  gateModelForAgentSupport,
  gateModelForKeys,
  isCustomOpenAiModelId,
  modelUsesStandardChat,
  openAiCompatibleProfileIdFromModelId,
} from '@/src/shared/constants/ai-models.constants'
import {
  isOpenAiCompatibleRuntimeReady,
  resolveOpenAiCompatibleConversationMode,
  resolveOpenAiCompatibleProfile,
} from '@/src/shared/utils/openai-compatible.utils'
import {
  normalizeOpenAiCompatibleTransport,
  type OpenAiCompatibleProfile,
} from '@/src/shared/types/openai-compatible.types'
import { downloadMedicalChatExecution } from '@/features/medical-chat/utils/ai-execution-export'
import { AiExecutionDiagnosticsDialog } from '@/src/shared/components/AiExecutionDiagnosticsDialog'

/**
 * Destination + execution identity for one chat transcript. A custom endpoint
 * is more than its logical picker id: editing the URL/upstream model/transport
 * or changing whether it receives Agent tools creates a new privacy boundary.
 *
 * Every CLOUD model shares ONE identity on purpose. The boundary protects
 * against transcript content crossing between trust domains (a hospital
 * endpoint's FHIR tool results must not be replayed to a public provider, and
 * vice versa) — but Gemini→GPT is the same trust domain, and clearing there
 * destroyed the conversation (and any half-streamed answer) on an ordinary
 * picker change. Messages are tagged with their own modelId, so one thread
 * legitimately holds answers from several cloud models.
 */
export function medicalChatRuntimeIdentity(
  modelId: string,
  profile: OpenAiCompatibleProfile | null,
): string {
  if (!isCustomOpenAiModelId(modelId)) {
    return JSON.stringify(['cloud'])
  }
  return JSON.stringify([
    'custom',
    profile?.profileId ?? openAiCompatibleProfileIdFromModelId(modelId) ?? modelId,
    profile?.baseUrl ?? '',
    profile?.modelId ?? '',
    normalizeOpenAiCompatibleTransport(profile?.transport),
    resolveOpenAiCompatibleConversationMode(profile),
  ])
}

function useRuntimeBoundaryGuard(identity: string, credential: string | null) {
  /* eslint-disable react-hooks/refs -- This is an intentional synchronous
   * privacy gate. An external custom-to-cloud render must remain unable to
   * persist the previous transcript until its effect has cleared the chat. */
  const identityRef = useRef(identity)
  const credentialRef = useRef(credential)
  const transitionPending =
    identityRef.current !== identity || credentialRef.current !== credential

  const adopt = useCallback((nextIdentity: string, nextCredential: string | null) => {
    identityRef.current = nextIdentity
    credentialRef.current = nextCredential
  }, [])

  return { transitionPending, adopt }
  /* eslint-enable react-hooks/refs */
}

export default function MedicalChat() {
  const { audience } = useAudience()
  const { t } = useLanguage()
  const { user, isAnonymous, loading: authLoading } = useAuth()
  // The chat's own persisted pick, already key-gated (what will actually run).
  // Picked in-panel (header strip; toolbar in expanded mode), not in Settings.
  const model = useEffectiveModel('chat')
  const chatModelPref = useModelPref('chat')
  const setModelFor = useSetModelFor()
  const openAiKey = useAiConfigStore((state) => state.apiKey)
  const geminiKey = useAiConfigStore((state) => state.geminiKey)
  const claudeKey = useAiConfigStore((state) => state.claudeKey)
  const openAiCompatibleProfiles = useAiConfigStore(
    (state) => state.openAiCompatibleProfiles,
  )
  const openAiCompatible = resolveOpenAiCompatibleProfile(
    model,
    openAiCompatibleProfiles,
  )
  const customModelDisplayNames = useMemo<Readonly<Record<string, string>>>(() => (
    Object.fromEntries(openAiCompatibleProfiles.map((profile) => [
      customOpenAiModelIdForProfile(profile.profileId),
      profile.modelId.trim(),
    ]))
  ), [openAiCompatibleProfiles])
  const isCustomEndpoint = isCustomOpenAiModelId(model)
  const isStandardChat = isCustomEndpoint
    ? resolveOpenAiCompatibleConversationMode(openAiCompatible) === 'standard'
    : modelUsesStandardChat(model)
  const runtimeIdentity = useMemo(
    () => medicalChatRuntimeIdentity(model, openAiCompatible),
    [model, openAiCompatible],
  )
  // Credentials are deliberately tracked outside runtimeIdentity: a replaced
  // secret is still a privacy boundary, but secrets must never enter a string
  // that might later be logged or surfaced for diagnostics.
  const runtimeCredential = openAiCompatible?.apiKey ?? null
  // This guard is also a synchronous history gate. On an externally-triggered
  // custom -> cloud transition the render sees a new identity before the
  // boundary effect can clear messages; retaining the old boundary prevents
  // Firestore auto-save / smart-title effects from observing that old text.
  const {
    transitionPending: runtimeTransitionPending,
    adopt: adoptRuntimeBoundary,
  } = useRuntimeBoundaryGuard(runtimeIdentity, runtimeCredential)
  const [, rerenderAfterRuntimeBoundary] = useState(0)
  // Selecting the hospital endpoint is also a privacy boundary: chat messages
  // must not be copied to Firestore or title/suggestion helper proxies.
  const cloudChatHistoryEnabled = !!user && !isCustomEndpoint &&
    !runtimeTransitionPending
  const { systemPrompt, updateSystemPrompt, resetSystemPrompt, isCustomPrompt } = useSystemPrompt()
  const { addTemplate, updateTemplate, saveTemplates, templates } = useChatTemplates()
  const input = useChatInput()
  const imageUpload = useImageUpload()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  // Expand/collapse state (independent UI state)
  const expandable = useExpandable()
  const { isExpanded } = expandable
  
  // Header visibility state (default collapsed for more chat space)
  const [showHeader, setShowHeader] = useState(false)
  const [localModeNoticeDismissed, setLocalModeNoticeDismissed] = useState(false)
  
  // Prompt Gallery state
  const [showPromptGallery, setShowPromptGallery] = useState(false)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  
  // Auth Dialog state
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  // New-conversation confirm — only shown when the current chat would be lost
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false)
  const [replyDraft, setReplyDraft] = useState<ChatReplyReference | null>(null)
  
  // FHIR context for chat history (patient ID and server URL)
  const { patientId, fhirServerUrl } = useFhirContext()
  
  // FHIR error handling
  const { error: patientError } = usePatient()
  const {
    error: clinicalDataError,
    isLoading: clinicalDataLoading,
    isFetching: clinicalDataFetching,
  } = useClinicalData()
  
  // Auto-save chat to Firestore (debounced)
  // Note: patientName is only used for UI display, never stored in Firestore
  // Auto-save is enabled when user is logged in, even without FHIR data
  const { forceSave } = useAutoSaveChat({
    patientId: patientId || undefined,
    fhirServerUrl: fhirServerUrl || undefined,
    debounceMs: 5000,
    enabled: cloudChatHistoryEnabled,
  })

  // Temporary / incognito chat mode (ChatGPT-style)
  const isTemporaryMode = useIsTemporaryMode()
  const setIsTemporaryMode = useSetIsTemporaryMode()
  const setMessagesGlobal = useSetChatMessages()
  const storedChatDataScope = useChatDataScope()
  const setChatDataScope = useSetChatDataScope()
  const setCurrentSessionId = useSetCurrentSessionId()

  const defaultChatDataScope: ChatDataScope = isCustomEndpoint
    ? (patientId ? 'patient' : 'general')
    : 'auto'
  // The runtime owns the default boundary. The only manual override is an
  // explicit patient-data opt-out; there is no heuristic question classifier.
  const chatDataScope: ChatDataScope = patientId && storedChatDataScope === 'general'
    ? 'general'
    : defaultChatDataScope

  const handleToggleTemporaryMode = useCallback(async () => {
    if (!isTemporaryMode) {
      // Entering: save the current chat (if any) before clearing.
      try {
        await forceSave()
      } catch {
        // Best-effort save; even if it fails we still enter temp mode.
      }
      setMessagesGlobal([])
      setCurrentSessionId(null)
      setReplyDraft(null)
      setChatDataScope(defaultChatDataScope)
      setIsTemporaryMode(true)
    } else {
      // Exiting: discard the in-memory temporary conversation.
      setMessagesGlobal([])
      setCurrentSessionId(null)
      setReplyDraft(null)
      setChatDataScope(defaultChatDataScope)
      setIsTemporaryMode(false)
    }
  }, [isTemporaryMode, forceSave, setMessagesGlobal, setCurrentSessionId, setChatDataScope, defaultChatDataScope, setIsTemporaryMode])

  // Clear input and reset textarea height
  const clearInputAndResetHeight = useCallback(() => {
    input.clear()
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input])
  
  // Mode follows the selected model. Cloud/tool-capable models use the deep
  // agent path; a hospital/local endpoint automatically takes the tool-less
  // standard path over the user-selected clinical snapshot.
  const chat = useAgentChat(
    systemPrompt,
    model,
    clearInputAndResetHeight,
    forceSave,
    chatDataScope,
  )

  // Wait for the full first response and a persisted session before naming it.
  useSmartTitleGeneration({
    enabled: cloudChatHistoryEnabled && !isTemporaryMode,
    isStreaming: chat.isLoading,
  })

  // "Next step" suggestion chips, generated after each answer completes.
  const {
    suggestions: followupSuggestions,
    generate: generateFollowups,
    clear: clearFollowups,
  } = useFollowupSuggestions(isCustomEndpoint ? model : undefined)

  const handleTogglePatientData = useCallback(() => {
    setChatDataScope(chatDataScope === 'general' ? defaultChatDataScope : 'general')
    setReplyDraft(null)
    clearFollowups()
  }, [chatDataScope, clearFollowups, defaultChatDataScope, setChatDataScope])

  // Initial mount adopts the current destination. Subsequent changes are
  // privacy boundaries, including external profile edits/hydration that did
  // not originate from either visible ModelPicker.
  const resetActiveChat = chat.handleReset
  const resetChatForRuntimeBoundary = useCallback(() => {
    // handleReset aborts first, then synchronously clears the Zustand messages
    // and saved-session pointer. Do this while the OLD model is still active so
    // enabling cloud history on the next render can never observe local text.
    resetActiveChat()
    setReplyDraft(null)
    clearFollowups()
    setLocalModeNoticeDismissed(false)
    setChatDataScope(defaultChatDataScope)
  }, [resetActiveChat, clearFollowups, setChatDataScope, defaultChatDataScope])

  const resolveSelectedModel = useCallback((requestedModelId: string) => {
    const requestedProfile = resolveOpenAiCompatibleProfile(
      requestedModelId,
      openAiCompatibleProfiles,
    )
    const keyGatedModel = gateModelForKeys(
      requestedModelId,
      {
        openAiKey,
        geminiKey,
        claudeKey,
        customAvailable: isOpenAiCompatibleRuntimeReady(requestedProfile),
      },
      MODEL_PREF_DEFAULTS.chat,
    )
    return gateModelForAgentSupport(keyGatedModel, MODEL_PREF_DEFAULTS.chat)
  }, [claudeKey, geminiKey, openAiCompatibleProfiles, openAiKey])

  const handleModelSelect = useCallback((requestedModelId: string) => {
    const nextModel = resolveSelectedModel(requestedModelId)
    const nextProfile = resolveOpenAiCompatibleProfile(
      nextModel,
      openAiCompatibleProfiles,
    )
    const nextIdentity = medicalChatRuntimeIdentity(nextModel, nextProfile)
    // Reset ONLY across a runtime-identity boundary (custom↔custom profile
    // change, custom↔cloud). Cloud↔cloud keeps the conversation — including a
    // stream still in flight, which finishes under the model that started it.
    if (nextIdentity !== runtimeIdentity) {
      resetChatForRuntimeBoundary()
      // Suppress the defensive effect's duplicate reset after this controlled
      // switch; the privacy cleanup above has already completed synchronously.
      adoptRuntimeBoundary(nextIdentity, nextProfile?.apiKey ?? null)
    }
    setModelFor('chat', requestedModelId)
  }, [adoptRuntimeBoundary, openAiCompatibleProfiles, resetChatForRuntimeBoundary, resolveSelectedModel, runtimeIdentity, setModelFor])

  useEffect(() => {
    if (!runtimeTransitionPending) return
    adoptRuntimeBoundary(runtimeIdentity, runtimeCredential)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cleanup must precede persistence re-enable
    resetChatForRuntimeBoundary()
    // Clearing an already-empty store may not schedule a component render. The
    // explicit tick lets cloud persistence turn on only after the cleanup above.
    rerenderAfterRuntimeBoundary((revision) => revision + 1)
  }, [adoptRuntimeBoundary, resetChatForRuntimeBoundary, runtimeCredential, runtimeIdentity, runtimeTransitionPending])
  
  // Ensure chat.messages is always an array
  const chatMessages = useMemo(() => (
    Array.isArray(chat.messages) ? chat.messages : []
  ), [chat.messages])

  // Reset the conversation when the patient context changes (a local bundle is
  // imported or cleared). Chat messages are in-memory only, so without this the
  // previous patient's conversation would linger on the newly-loaded patient —
  // a privacy leak. handleReset stops any in-flight stream, clears the messages,
  // and drops the saved-session pointer so the next turn starts fresh. The ref
  // keeps the listener stable while always invoking the active mode's reset.
  const handleResetRef = useRef(chat.handleReset)
  useEffect(() => {
    handleResetRef.current = chat.handleReset
  }, [chat.handleReset])
  useEffect(() => {
    const onBundleChange = () => {
      setReplyDraft(null)
      handleResetRef.current()
    }
    window.addEventListener('mediprisma:local-bundle-changed', onBundleChange)
    return () => window.removeEventListener('mediprisma:local-bundle-changed', onBundleChange)
  }, [])

  // A changed patient context restores the runtime's default: frontier models
  // return to automatic routing; local models use patient mode when available
  // and otherwise fail closed to general mode.
  const previousPatientIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (previousPatientIdRef.current !== patientId) {
      previousPatientIdRef.current = patientId
      setChatDataScope(defaultChatDataScope)
      setReplyDraft(null)
    }
  }, [patientId, defaultChatDataScope, setChatDataScope])

  // Normalize legacy scopes while preserving the explicit patient-data opt-out.
  useEffect(() => {
    if (storedChatDataScope !== chatDataScope) {
      setChatDataScope(chatDataScope)
    }
  }, [chatDataScope, setChatDataScope, storedChatDataScope])

  const template = useTemplateSelector()

  // Start a new conversation. Logged-in (non-temp) chats are already auto-saved
  // to history, so we persist + start fresh silently; signed-out / temp-mode
  // chats would be lost, so confirm first.
  const handleNewConversation = useCallback(async () => {
    if (chatMessages.length === 0) {
      setReplyDraft(null)
      chat.handleReset()
      setChatDataScope(defaultChatDataScope)
      return
    }
    if (cloudChatHistoryEnabled && !isTemporaryMode) {
      try {
        await forceSave()
      } catch {
        // Best-effort save; still start the new chat.
      }
      setReplyDraft(null)
      chat.handleReset()
      setChatDataScope(defaultChatDataScope)
      toast.success(t.chat.newChatSavedToast)
      return
    }
    setShowNewChatConfirm(true)
  }, [chatMessages.length, cloudChatHistoryEnabled, isTemporaryMode, forceSave, chat, setChatDataScope, defaultChatDataScope, t])

  const confirmNewConversation = useCallback(() => {
    setShowNewChatConfirm(false)
    setReplyDraft(null)
    chat.handleReset()
    setChatDataScope(defaultChatDataScope)
  }, [chat, setChatDataScope, defaultChatDataScope])
  
  // Voice recording with callback to insert transcript into input
  const handleTranscriptReady = useCallback((text: string) => {
    input.setInput((prev: string) => 
      prev.trim().length > 0 ? `${prev.trimEnd()}\n\n${text}` : text
    )
    if (textareaRef.current) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight
        }
      }, 0)
    }
  }, [input])
  
  const voice = useVoiceRecording(
    handleTranscriptReady,
    isCustomEndpoint ? model : null,
  )
  const recordingStatus = useRecordingStatus(voice)

  // API key validation
  const { hasApiKey } = useApiKeyValidation(
    model,
    openAiKey,
    geminiKey,
    claudeKey,
    openAiCompatible,
  )

  // Agent chat runs through the Firebase proxy for ANY session — a real account
  // OR an anonymous free-tier visitor (small Perplexity/chat quota) — or with
  // the user's own API key. Anonymous visitors have `user === null` by design
  // (login-gated features stay gated), so a plain `!user` check wrongly blocks
  // them; include `isAnonymous`. Only warn once auth has resolved and there is
  // genuinely no path (which means anonymous sign-in itself is unavailable).
  const apiKeyAvailable = hasApiKey()
  const hasChatRuntime = isCustomEndpoint
    ? apiKeyAvailable
    : apiKeyAvailable || !!user || isAnonymous
  // A tool object closes over the current React Query snapshot at send time.
  // Starting an Agent turn while that snapshot is still loading/refetching can
  // otherwise make an empty interim collection look like a clinical absence.
  const clinicalDataPending = !!patientId
    && (clinicalDataLoading || clinicalDataFetching)
  const canUseChat = hasChatRuntime && (
    chatDataScope === 'general' || !clinicalDataPending
  )
  const showApiKeyWarning = !authLoading && !hasChatRuntime

  // Clear images after sending message
  const clearImagesAfterSend = useCallback(() => {
    imageUpload.clearImages()
  }, [imageUpload])

  // Handlers
  const handleSend = useCallback(async (overrideText?: string) => {
    // A suggestion chip passes its prompt as overrideText; clear the chips on
    // any send so they don't linger across the new exchange.
    clearFollowups()
    const trimmed = (typeof overrideText === "string" ? overrideText : input.input).trim()
    const hasImages = imageUpload.images.length > 0
    const activeReply = typeof overrideText === "string" ? null : replyDraft
    
    // Require either text or images
    if (!trimmed && !hasImages) return

    // Usage analytics: shape of the turn only. `trimmed`, the reply reference
    // and the images themselves never leave this function.
    trackEvent('chat_send', {
      source: typeof overrideText === "string" ? 'chip' : 'typed',
      has_image: hasImages,
      model_id: chatModelPref,
      agent_mode: !isStandardChat,
    })

    // Convert File objects to ChatImage (base64) for API
    let chatImages: ChatImage[] | undefined
    if (hasImages) {
      chatImages = await Promise.all(
        imageUpload.images.map(async (img) => ({
          data: await fileToBase64(img.file),
          mimeType: img.file.type,
          fileName: img.file.name,
          size: img.file.size,
        }))
      )
    }
    
    // Clear input and reset height immediately after sending
    clearInputAndResetHeight()
    setReplyDraft(null)
    
    // Clear images after successful send
    clearImagesAfterSend()
    
    // Pass images to chat handler (this will add user message to state)
    // Note: handleSend is async and will start streaming, but user message is added to state immediately
    const sendPromise = chat.handleSend(trimmed, chatImages, activeReply)
    
    // Stage 1: Save user message immediately after it's added to state (prevent data loss)
    // This ensures user input is never lost even if AI response fails or gets interrupted
    // Use queueMicrotask to ensure state update has been processed
    queueMicrotask(async () => {
      try {
        await forceSave()
      } catch (error) {
        console.error('[Chat] Failed to save user message:', error)
        // Non-blocking: the message is already in state and the answer is
        // streaming. Say the cloud copy didn't land (stage 2 retries) instead
        // of letting the user believe the turn is safely stored.
        toast.warning(t.medicalChat.saveMessageFailed)
      }
    })
    
    // Wait for AI response to complete
    await sendPromise
    // Stage 2: AI response completion will trigger another forceSave to update with full conversation
  }, [input, imageUpload.images, replyDraft, chat, clearImagesAfterSend, clearInputAndResetHeight, forceSave, clearFollowups, t, chatModelPref, isStandardChat])

  const handleReplyToSelection = useCallback((reply: ChatReplyReference) => {
    setReplyDraft(reply)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  // Generate "next step" chips when an assistant answer finishes streaming.
  // Guarded by the assistant message id so it fires once per answer; clears when
  // the conversation is emptied. Fails closed inside the hook.
  const lastSuggestedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (chat.isLoading) return
    if (chatMessages.length === 0) {
      lastSuggestedIdRef.current = null
      clearFollowups()
      return
    }
    const last = chatMessages[chatMessages.length - 1]
    const content = (last?.content || "").trim()
    if (!last || last.role !== "assistant" || !content) return
    // Skip the thinking placeholder and failed turns (a failed turn now keeps
    // its partial text and carries the reason in `error`).
    if (content.startsWith("🤔") || last.error) return
    if (lastSuggestedIdRef.current === last.id) return
    // The reader's own questions this session feed implicit personalisation; the
    // last one is the current question (buildMessages filters it out of "recent").
    const answerScope = last.dataScope ?? chatDataScope
    const userMessages = chatMessages
      .filter((message) => {
        if (message.role !== 'user') return false
        if (answerScope === 'auto') return true
        if (answerScope === 'general') return message.dataScope === 'general'
        if (answerScope === 'patient') {
          return message.dataScope === 'patient' || !message.dataScope
        }
        return message.dataScope === 'patient' ||
          message.dataScope === 'patient-literature' ||
          message.dataScope === 'auto' ||
          !message.dataScope
      })
      .map((message) => message.content)
    const lastUser = userMessages[userMessages.length - 1]
    if (!lastUser) return
    lastSuggestedIdRef.current = last.id
    generateFollowups(lastUser, content, {
      recentUserMessages: userMessages,
      isDeepMode: !isStandardChat,
    })
  }, [chat.isLoading, chatMessages, generateFollowups, clearFollowups, isStandardChat, chatDataScope])
  
  // Auto-resize textarea
  useTextareaAutoResize(textareaRef, input.input)

  const scrollTextareaToBottom = useCallback(() => {
    if (textareaRef.current) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight
        }
      }, 0)
    }
  }, [])

  const handleInsertTemplate = useCallback(() => {
    const templateContent = template.selectedTemplate?.content?.trim()
    if (templateContent) {
      input.insertTextWithTrim(templateContent)
      scrollTextareaToBottom()
    }
  }, [input, template.selectedTemplate, scrollTextareaToBottom])

  const handleExportAiExecution = useCallback(() => {
    if (!chat.latestExecution) return
    downloadMedicalChatExecution(chat.latestExecution)
  }, [chat.latestExecution])

  const galleryImport = useGalleryImport({
    scope: `${user?.uid ?? 'guest'}:${audience}:chat`,
    items: templates.map(item => ({ ...item, title: item.label })),
    add: value => addTemplate({ label: value.title, content: value.content, sourcePromptKey: value.sourcePromptKey, sourcePromptFingerprint: value.sourcePromptFingerprint, sourcePromptVersion: value.sourcePromptVersion }),
    update: (id, value) => updateTemplate(id, { label: value.title, content: value.content, sourcePromptFingerprint: value.sourcePromptFingerprint, sourcePromptVersion: value.sourcePromptVersion }),
    save: saveTemplates,
    insert: content => { input.insertTextWithTrim(content); scrollTextareaToBottom() },
  })
  const handleSelectPrompt = (prompt: SharedPrompt, useAs?: PromptType, onImported?: () => void) => {
    if (useAs === 'summary') return
    setShowPromptGallery(false)
    galleryImport.importPrompt({ title: prompt.title, content: prompt.prompt, sourcePromptKey: gallerySourceKey(prompt), sourcePromptVersion: prompt.version ?? 1 }, onImported)
  }

  // Keyboard shortcuts
  useKeyboardShortcuts(isExpanded, expandable.collapse)

  const chatContent = (
    // The panel is the surface: no box around the conversation.
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none !gap-0 !py-0">
      {!isExpanded && (
        // Occasional controls (history, titles, model, maximize) wait in the
        // row until the pointer or focus reaches it; 新對話 and an active
        // 無痕 state stay in view.
        <div data-tour="medical-chat-controls" className="reveal-scope relative flex items-center justify-between gap-2 px-1 py-1">
          <div className="flex items-center gap-1">
            <span className="reveal-on-hover inline-flex">
            {/* Keep the history drawer visible even when signed out — its
                internal empty-state shows a "sign in to save chats" CTA,
                which is how users discover the feature exists. The temp-
                mode toggle, on the other hand, is a "don't save" switch
                that makes no sense when we weren't saving in the first
                place, so hide it for signed-out users. */}
            <ChatHistoryDrawer persistenceEnabled={cloudChatHistoryEnabled} />
            </span>
            {user && (
              <button
                onClick={handleToggleTemporaryMode}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors ${
                  isTemporaryMode
                    ? 'bg-foreground/[0.07] font-medium text-foreground hover:bg-foreground/10'
                    : 'reveal-on-hover text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title={
                  isTemporaryMode
                    ? ((t.chat as any).temporaryModeExit ?? '結束無痕對話')
                    : ((t.chat as any).temporaryModeEnter ?? '開啟無痕對話')
                }
              >
                <MessageSquareDashed className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {isTemporaryMode
                    ? ((t.chat as any).temporaryModeActive ?? '無痕中')
                    : ((t.chat as any).temporaryModeLabel ?? '無痕')}
                </span>
              </button>
            )}
          </div>
          {/* In normal flow (not absolutely centered): the right-side group
              grew a model picker, and a centered overlay overlapped it at
              typical panel widths. justify-between keeps this visually
              near-center without ever colliding. */}
          <button
            onClick={() => setShowHeader(!showHeader)}
            className="reveal-on-hover shrink-0 whitespace-nowrap px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            title={showHeader ? t.chat.hideHeader : t.chat.showHeader}
          >
            {showHeader ? `▲ ${t.chat.hideHeader}` : `▼ ${t.chat.showHeader}`}
          </button>
          <div className="flex min-w-0 items-center gap-1">
            {/* The toolbar above the input is already crowded — the model
                picker lives here in the header strip instead. */}
            <span className="reveal-on-hover inline-flex min-w-0">
            <ModelPicker
              modelId={chatModelPref}
              fallbackModelId={MODEL_PREF_DEFAULTS.chat}
              onSelect={handleModelSelect}
              tooltip={isStandardChat
                ? t.medicalChat.localStandardModeTitle
                : t.modelPicker.chatTooltip}
              agentModeActive
            />
            </span>
            <button
              onClick={handleNewConversation}
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t.chat.newChat}
            >
              <SquarePen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.chat.newChat}</span>
            </button>
            <button
              onClick={expandable.toggle}
              className="reveal-on-hover shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
              title={t.common.maximize}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {!isExpanded && showHeader && (
        <ChatHeader
          recordingStatus={recordingStatus.recordingStatusLabel}
          asrError={voice.asrError}
          chatError={chat.error}
          isRecording={voice.isRecording}
          isAsrLoading={voice.isAsrLoading}
          systemPrompt={systemPrompt}
          onUpdateSystemPrompt={updateSystemPrompt}
          onResetSystemPrompt={resetSystemPrompt}
          isCustomPrompt={isCustomPrompt}
          isExpanded={isExpanded}
        />
      )}
      
      <CardContent className={`min-h-0 flex-1 overflow-y-auto bg-transparent p-0 ${isExpanded || !showHeader ? '' : 'border-t'}`}>
        {(patientError || clinicalDataError) && (
          <div className="mx-4 mt-4 mb-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 px-3 py-2 text-sm">
            <div className="font-medium text-amber-800 dark:text-amber-200 mb-1">{t.medicalChat.fhirDataWarning}</div>
            <div className="text-amber-700 dark:text-amber-300 text-xs">
              {patientError && <div>• {t.errors.fetchPatient}</div>}
              {clinicalDataError && <div>• {t.errors.fetchClinicalData}</div>}
            </div>
          </div>
        )}
        <ChatMessageList
          messages={chatMessages}
          isLoading={chat.isLoading}
          isStandardChatMode={isStandardChat}
          dataScope={chatDataScope}
          customModelDisplayNames={customModelDisplayNames}
          scrollSignal={followupSuggestions.length}
          onReplyToSelection={handleReplyToSelection}
          onRetry={chat.retryLastMessage}
          afterMessages={
            <SuggestionChips
              suggestions={followupSuggestions}
              onPick={(p) => handleSend(p)}
              disabled={chat.isLoading}
            />
          }
        />
      </CardContent>

      <CardFooter className="flex max-h-[80%] shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain border-t px-1 pb-2 sm:px-2 !pt-2">
        <div
          data-tour="medical-chat-composer"
          className="reveal-scope flex w-full flex-col gap-1"
        >
          <ChatToolbar
            onInsertTemplate={handleInsertTemplate}
            templates={template.templates}
            selectedTemplateId={template.selectedTemplate?.id}
            onTemplateChange={template.setSelectedTemplateId}
            hasTemplateContent={!!template.selectedTemplate?.content?.trim()}
            onOpenGallery={() => setShowPromptGallery(true)}
            onManageTemplates={() => setShowTemplateManager(true)}
            onModelSelect={handleModelSelect}
            showModelPicker={isExpanded}
            patientDataDisabled={chatDataScope === 'general'}
            canTogglePatientData={!!patientId}
            patientDataToggleDisabled={chat.isLoading}
            onTogglePatientData={handleTogglePatientData}
            onOpenAiExecution={() => setDiagnosticsOpen(true)}
            canExportAiExecution={!!chat.latestExecution && !chat.isLoading}
          />
          {showApiKeyWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 px-3 py-2 text-xs">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
              <div className="flex-1 text-amber-800 dark:text-amber-200">
                <div className="font-medium mb-1">
                  {isCustomEndpoint
                    ? t.settings.openAiCompatibleNotConfigured
                    : t.medicalChat.apiKeyWarningTitle}
                </div>
                <div className="text-amber-700 dark:text-amber-300">
                  {isCustomEndpoint
                    ? t.settings.openAiCompatibleConfigureToUse
                    : t.medicalChat.apiKeyWarningMessage.split(t.medicalChat.loginLink).map((part, index, array) => (
                        index < array.length - 1 ? (
                          <span key={index}>
                            {part}
                            <button
                              onClick={() => setShowAuthDialog(true)}
                              className="underline hover:text-amber-900 dark:hover:text-amber-100 font-medium"
                            >
                              {t.medicalChat.loginLink}
                            </button>
                          </span>
                        ) : part
                      ))}
                </div>
              </div>
            </div>
          )}
          {isCustomEndpoint && isStandardChat && canUseChat && !localModeNoticeDismissed && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.medicalChat.localStandardModeTitle}</div>
                <div className="mt-0.5 leading-relaxed text-sky-800/90 dark:text-sky-200/85">
                  {chatDataScope === 'general'
                    ? t.medicalChat.localStandardGeneralModeDescription
                    : t.medicalChat.localStandardModeDescription}
                </div>
                <div className="mt-1 font-medium text-sky-700 dark:text-sky-300">
                  {t.medicalChat.localStandardModeSwitchHint}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLocalModeNoticeDismissed(true)}
                aria-label={t.common.close}
                title={t.common.close}
                className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sky-700/70 transition-colors hover:bg-sky-100 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-200/70 dark:hover:bg-sky-500/15 dark:hover:text-sky-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {isQuotaExceededError(chat.error) && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 px-3 py-2 text-xs">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
              <div className="flex-1 text-amber-800 dark:text-amber-200">
                <div className="font-medium mb-1">{t.medicalChat.quotaBannerTitle}</div>
                <div className="text-amber-700 dark:text-amber-300">
                  {(!user || isAnonymous)
                    ? t.medicalChat.quotaBannerMessageAnon.split(t.medicalChat.loginLink).map((part, index, array) => (
                        index < array.length - 1 ? (
                          <span key={index}>
                            {part}
                            <button
                              onClick={() => setShowAuthDialog(true)}
                              className="underline hover:text-amber-900 dark:hover:text-amber-100 font-medium"
                            >
                              {t.medicalChat.loginLink}
                            </button>
                          </span>
                        ) : part
                      ))
                    : t.medicalChat.quotaBannerMessageUser}
                </div>
              </div>
            </div>
          )}
          {isTemporaryMode && user && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-foreground/80">
              <span className="inline-flex items-center gap-1.5">
                <MessageSquareDashed className="h-3.5 w-3.5" />
                {(t.chat as any).temporaryModeBanner ?? '無痕對話 · 此對話不會被儲存'}
              </span>
              <button
                onClick={handleToggleTemporaryMode}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-foreground/[0.07]"
                title={(t.chat as any).temporaryModeExit ?? '結束無痕對話'}
              >
                <X className="h-3 w-3" />
                {(t.chat as any).temporaryModeExitShort ?? '結束'}
              </button>
            </div>
          )}
          <ChatInputArea
            input={input}
            textareaRef={textareaRef}
            isLoading={chat.isLoading}
            onSend={handleSend}
            onStopGeneration={() => chat.stopGeneration()}
            voice={voice}
            images={imageUpload}
            disabled={!canUseChat}
            isPrivateEndpoint={isCustomEndpoint}
            replyDraft={replyDraft}
            onCancelReply={() => setReplyDraft(null)}
          />
        </div>
      </CardFooter>
    </Card>
  )

  const newChatConfirmDialog = (
    <AlertDialog open={showNewChatConfirm} onOpenChange={setShowNewChatConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.chat.newChatConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.chat.newChatConfirmDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmNewConversation}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t.chat.newChat}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const diagnosticsDialog = (
    <AiExecutionDiagnosticsDialog
      open={diagnosticsOpen}
      onOpenChange={setDiagnosticsOpen}
      records={chat.latestExecution ? [chat.latestExecution] : []}
      labels={t.aiDiagnostics}
      onDownloadAll={handleExportAiExecution}
      onDownloadRecord={handleExportAiExecution}
    />
  )

  // Render expanded overlay or normal view
  if (isExpanded) {
    return (
      <>
        <ExpandedOverlay
          content={chatContent}
          onCollapse={expandable.collapse}
          placeholderText={t.chat.expandedMode}
        />
        {galleryImport.dialog}
        <PromptGalleryDialog
          open={showPromptGallery}
          onOpenChange={setShowPromptGallery}
          mode="chat"
          onSelectPrompt={handleSelectPrompt}
        />
        <ChatTemplatesManagerDrawer
          open={showTemplateManager}
          onOpenChange={setShowTemplateManager}
          initialTemplateId={template.selectedTemplate?.id}
        />
        <AuthDialog
          open={showAuthDialog}
          onOpenChange={setShowAuthDialog}
        />
        {newChatConfirmDialog}
        {diagnosticsDialog}
      </>
    )
  }

  return (
    <>
      {chatContent}
      {galleryImport.dialog}
      <PromptGalleryDialog
        open={showPromptGallery}
        onOpenChange={setShowPromptGallery}
        mode="chat"
        onSelectPrompt={handleSelectPrompt}
      />
      <ChatTemplatesManagerDrawer
        open={showTemplateManager}
        onOpenChange={setShowTemplateManager}
        initialTemplateId={template.selectedTemplate?.id}
      />
      <AuthDialog
        open={showAuthDialog}
        onOpenChange={setShowAuthDialog}
      />
      {newChatConfirmDialog}
      {diagnosticsDialog}
    </>
  )
}
