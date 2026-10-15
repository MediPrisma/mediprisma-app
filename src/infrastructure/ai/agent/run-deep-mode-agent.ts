/**
 * Run Deep-Mode Agent (headless core)
 *
 * The deep-mode agent "brain" extracted out of the React hook
 * (features/medical-chat/hooks/useAgentChat.ts) so the SAME orchestration runs
 * in two places:
 *   1. The UI hook (maps emitted events → setChatMessages).
 *   2. Headless eval scripts in node (no React, no DOM).
 *
 * Lives in the infrastructure layer (not core) because it drives the AI SDK and
 * the streaming idle-watchdog — core stays pure/UI-free and may not import
 * infrastructure. The pure pieces it relies on (stream post-processing) remain
 * in core and are imported here.
 *
 * The UI and eval harness share these same three streamText rounds (main →
 * follow-up → synthesis), tool-loop limits, tool-result summarisation and
 * citation post-processing. The only thing left behind in the hook is pure UI
 * rendering: every setChatMessages call becomes an `onEvent` emission, and the
 * 100ms update throttling (a main-thread-blocking guard, not agent behaviour)
 * stays in the hook's event handler.
 */

import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type StopCondition, type ToolSet } from "ai"
import { processAgentStreamUseCase } from "@/src/core/use-cases/agent/process-agent-stream.use-case"
import { getToolDisplayName } from "@/src/shared/constants/agent-tool-names.constants"
import { withIdleTimeout } from "@/src/infrastructure/ai/streaming/stream-idle-timeout"

export type AgentRunRole = "system" | "user" | "assistant"

export interface AgentRunMessage {
  role: AgentRunRole
  content: string
}

/**
 * The subset of `t.agent` strings the orchestration itself consumes. These are
 * part of the harness (they shape the follow-up/synthesis prompts and the
 * tool-result summaries), so the eval must pass the SAME translations the UI
 * uses — otherwise it measures a different harness.
 */
export interface AgentRunTranslations {
  organizingResults: string
  queriedFhirData: string
  answerQuestion: string
  answerQuestionCitationsHint?: string
  /** Shown to the reader (status trail + answer footnote) when the tool loop
   * was stopped by `repeatedToolCallIs`. Optional: eval harnesses omit it. */
  repeatedQueryStopped?: string
  /** Appended to the follow-up instruction in the same case, so the model
   * knows why it was cut off and does not repeat the query again. */
  repeatedQueryHint?: string
  /** Same pair for the generic step ceiling (`stepCountIs`): the loop ended
   * because the budget ran out, not because the search was complete. */
  stepLimitReached?: string
  stepLimitHint?: string
  synthesizeResults: string
  queryResult: string
  queryFailed: string
  noData: string
  noDataFound: string
  foundRecords: string
  toolNames: Record<string, string>
}

/**
 * Events the core emits in place of the hook's setChatMessages calls. The hook
 * translates each back into a UI update (with throttling); eval scripts ignore
 * them or record them.
 */
export type AgentRunEvent =
  /** A labelled intermediate state (tool-running / organizing). UI shows it as
   *  content AND appends it to agentStates. */
  | { type: "status"; state: string }
  /** Accumulated answer text so far (UI sets content, throttled). */
  | { type: "content"; content: string }
  /** A tool was invoked. UI shows the 🔍 label + tracks the tool-name list. */
  | { type: "tool-call"; toolName: string; state: string; toolCalls: string[] }
  /** A tool returned (collected for the trajectory; no direct UI update). */
  | { type: "tool-result"; toolName: string; result: unknown }
  /** Final processed content + the full tool-name list. */
  | { type: "final"; content: string; toolCalls: string[] }

export interface AgentTrajectoryStep {
  round: number
  kind: "tool-call" | "tool-result" | "text"
  toolName?: string
  input?: unknown
  result?: unknown
  text?: string
}

export interface RunDeepModeAgentParams {
  /** Provider model from aiProviderFactory.create({...}).model */
  model: LanguageModel
  /** system message + conversation history (already assembled by the caller) */
  messages: AgentRunMessage[]
  tools: ToolSet | undefined
  translations: AgentRunTranslations
  /** idle-timeout window in ms (caller resolves it — UI from env, eval pins it) */
  idleMs: number
  /** caller owns the controller so it can wire a stop button / overall timeout */
  abortController: AbortController
  /** Force only step zero when routing found one unambiguous record tool. */
  initialToolName?: string
  /** Execute an unambiguous compact tool locally before the first model call. */
  preExecuteInitialTool?: boolean
  /** Deterministic arguments extracted from explicit user constraints. */
  preExecuteInitialToolInput?: Record<string, unknown>
  /** Optional provider reasoning control. Callers must only opt in for a
   * compatible endpoint model (currently gpt-oss). */
  reasoningEffort?: 'low' | 'medium' | 'high'
  onEvent?: (event: AgentRunEvent) => void
}

export interface AgentRunUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface RunDeepModeAgentResult {
  answer: string
  toolCalls: string[]
  citations: string[]
  trajectory: AgentTrajectoryStep[]
  /** Token usage summed across all streamText rounds (main + follow-up + synthesis). */
  usage: AgentRunUsage
}

function stableToolInput(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableToolInput).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableToolInput(entry)}`)
      .join(',')}}`
  }
  const serialized = JSON.stringify(value)
  return serialized === undefined ? String(value) : serialized
}

/** Stop a model that asks for the exact same tool data on consecutive steps.
 * Smaller OpenAI-compatible models can otherwise keep receiving and requesting
 * the same record until the generic ten-step ceiling, which looks like an
 * endless spinner and needlessly repeats hospital queries. The result is
 * already available for the normal no-text follow-up/synthesis path.
 *
 * Three, not two: a single repeat is something capable models do on purpose
 * (a retry after a partial result, a re-read before answering) and then move
 * on to a different query. Stopping there would cut off the rest of the
 * investigation; a third identical batch is a loop. */
/** Generic ceiling on tool-calling steps per turn. Every step re-sends the
 * whole context, so cost and latency grow roughly quadratically with it. */
export const MAX_TOOL_STEPS = 10

export function repeatedToolCallIs(
  consecutiveSteps = 3,
): StopCondition<ToolSet> {
  return ({ steps }) => {
    if (consecutiveSteps < 2 || steps.length < consecutiveSteps) return false
    const recent = steps.slice(-consecutiveSteps)
    const signatures = recent.map((step) => {
      if (step.toolCalls.length === 0) return null
      return step.toolCalls
        .map((call) => `${call.toolName}:${stableToolInput(call.input)}`)
        .sort()
        .join('|')
    })
    const first = signatures[0]
    return first !== null && signatures.every((signature) => signature === first)
  }
}

/**
 * Run the deep-mode agent once and return its final answer + trajectory.
 * Throws on stream error / abort (callers keep their own try/catch, exactly as
 * the hook did before extraction).
 */
export async function runDeepModeAgent(
  params: RunDeepModeAgentParams,
): Promise<RunDeepModeAgentResult> {
  const {
    model,
    messages,
    tools,
    translations: t,
    idleMs,
    abortController,
    initialToolName,
    preExecuteInitialTool,
    preExecuteInitialToolInput,
    reasoningEffort,
    onEvent,
  } = params

  const reasoningOptions = reasoningEffort === undefined
    ? {}
    : { providerOptions: { openai: { reasoningEffort } } }

  const emit = (event: AgentRunEvent) => onEvent?.(event)
  const onStreamIdle = () => abortController.abort()
  const trajectory: AgentTrajectoryStep[] = []

  // Token usage is summed across every streamText round below so callers (the
  // eval harness) can report tokens + cost per model.
  const usage: AgentRunUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const addUsage = (u: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) => {
    const inp = u.inputTokens ?? 0
    const out = u.outputTokens ?? 0
    usage.inputTokens += inp
    usage.outputTokens += out
    usage.totalTokens += u.totalTokens ?? inp + out
  }

  const summaryTranslations = {
    queryResult: t.queryResult,
    queryFailed: t.queryFailed,
    noData: t.noData,
    noDataFound: t.noDataFound,
    foundRecords: t.foundRecords,
  }

  let accumulatedContent = ""

  // Set by the stop conditions below; read by the follow-up prompt and the
  // reader-facing note once the loop has ended.
  let stoppedByRepeat = false
  let stoppedByStepLimit = false
  let stepCount = 0
  let lastStepHadToolCalls = false
  const loopStopNote = (): string | undefined =>
    stoppedByRepeat ? t.repeatedQueryStopped : stoppedByStepLimit ? t.stepLimitReached : undefined
  const repeatNote = (text: string): string => {
    const note = loopStopNote()
    return note && text.length > 0 ? `${text}

_${note}_` : text
  }
  const toolResults: Array<{ toolName: string; result: unknown }> = []
  const usedToolNames: string[] = []

  const initialTool = initialToolName ? tools?.[initialToolName] : undefined
  const executableInitialTool = initialTool as {
    execute?: (input: Record<string, unknown>) => unknown | Promise<unknown>
  } | undefined
  const shouldPreExecute = Boolean(preExecuteInitialTool && initialToolName && executableInitialTool?.execute)

  if (shouldPreExecute && initialToolName && executableInitialTool?.execute) {
    if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const initialToolInput = preExecuteInitialToolInput ?? {}
    const displayName = getToolDisplayName(initialToolName, t.toolNames)
    usedToolNames.push(initialToolName)
    trajectory.push({ round: 1, kind: 'tool-call', toolName: initialToolName, input: initialToolInput })
    emit({
      type: 'tool-call',
      toolName: initialToolName,
      state: `🔍 ${displayName}...`,
      toolCalls: [...usedToolNames],
    })
    const toolResult = await executableInitialTool.execute(initialToolInput)
    toolResults.push({ toolName: initialToolName, result: toolResult })
    trajectory.push({ round: 1, kind: 'tool-result', toolName: initialToolName, result: toolResult })
    emit({ type: 'tool-result', toolName: initialToolName, result: toolResult })
  } else {
    // Stream with tools. stopWhen enables the AI SDK's NATIVE multi-step loop:
    // after a tool call the SDK feeds the result back to the model automatically
    // and continues, up to N steps.
    const repeatStop = repeatedToolCallIs(3)
    const result = await streamText({
      model,
      messages: messages as ModelMessage[],
      tools,
      stopWhen: [
        stepCountIs(MAX_TOOL_STEPS),
        (context) => {
          if (!repeatStop(context)) return false
          stoppedByRepeat = true
          return true
        },
      ],
      ...reasoningOptions,
      prepareStep: initialToolName
        ? ({ stepNumber }) => stepNumber === 0
          ? { toolChoice: { type: 'tool', toolName: initialToolName } }
          : { toolChoice: 'auto' }
        : undefined,
      abortSignal: abortController.signal,
      onStepFinish: ({ toolCalls }) => {
        stepCount += 1
        lastStepHadToolCalls = Boolean(toolCalls && toolCalls.length > 0)
        if (toolCalls && toolCalls.length > 0) {
          const toolNames = toolCalls
            .map((tc) => getToolDisplayName(tc?.toolName || "", t.toolNames))
            .join("、")
          emit({ type: "status", state: `🔍 ${toolNames}...` })
        }
      },
    })

    // Round 1 — main stream (idle-watchdog guarded)
    for await (const chunk of withIdleTimeout(result.fullStream, idleMs, onStreamIdle)) {
      if (chunk.type === "text-delta") {
        accumulatedContent += chunk.text
        emit({ type: "content", content: accumulatedContent })
      } else if (chunk.type === "tool-call") {
        const displayName = getToolDisplayName(chunk.toolName, t.toolNames)
        if (!usedToolNames.includes(chunk.toolName)) usedToolNames.push(chunk.toolName)
        trajectory.push({
          round: 1,
          kind: "tool-call",
          toolName: chunk.toolName,
          input: (chunk as { input?: unknown }).input,
        })
        emit({
          type: "tool-call",
          toolName: chunk.toolName,
          state: `🔍 ${displayName}...`,
          toolCalls: [...usedToolNames],
        })
      } else if (chunk.type === "tool-result") {
        const chunkAny = chunk as any
        const toolResult = chunkAny.result ?? chunkAny.output ?? chunkAny.toolResult ?? chunkAny
        toolResults.push({ toolName: chunk.toolName, result: toolResult })
        trajectory.push({ round: 1, kind: "tool-result", toolName: chunk.toolName, result: toolResult })
        emit({ type: "tool-result", toolName: chunk.toolName, result: toolResult })
      } else if (chunk.type === "error") {
        // A failed request (proxy 401 / no guest token / network) arrives as an
        // error chunk, NOT a throw. Propagate so the caller's catch surfaces it.
        throw (chunk as { error?: unknown }).error ?? new Error("AI stream error")
      }
    }
    addUsage(await result.usage)
    // The SDK continues after any step that called tools, so ending on the
    // ceiling with tool calls means the ceiling stopped it, not the model.
    stoppedByStepLimit = !stoppedByRepeat && stepCount >= MAX_TOOL_STEPS && lastStepHadToolCalls
    const stopNote = loopStopNote()
    if (stopNote) emit({ type: "status", state: `⚠️ ${stopNote}` })
  }

  if (accumulatedContent.length > 0) {
    accumulatedContent = repeatNote(accumulatedContent)
    trajectory.push({ round: 1, kind: "text", text: accumulatedContent })
    emit({
      type: "final",
      content: accumulatedContent,
      toolCalls: usedToolNames.length > 0 ? usedToolNames : [],
    })
  }

  // Round 2 — follow-up when there are tool results but the model produced no text.
  if (toolResults.length > 0 && accumulatedContent.length === 0) {
    emit({ type: "status", state: `📝 ${t.organizingResults}` })

    const { summary: toolResultsSummary, citations: literatureCitations } =
      processAgentStreamUseCase.buildToolResultsSummary(toolResults, summaryTranslations)

    const originalQuestion =
      [...messages].reverse().find((m) => m.role === "user")?.content || ""
    // Only inject the citation-preservation hint when literature search actually
    // produced numbered references — otherwise the LLM hallucinates [1][2] tags.
    const answerQuestionText =
      (literatureCitations.length > 0
        ? t.answerQuestion + (t.answerQuestionCitationsHint ?? "")
        : t.answerQuestion) +
      (stoppedByRepeat ? (t.repeatedQueryHint ?? "") : stoppedByStepLimit ? (t.stepLimitHint ?? "") : "")
    const followUpMessages = processAgentStreamUseCase.buildFollowUpMessages(
      messages,
      toolResultsSummary,
      originalQuestion,
      { queriedFhirData: t.queriedFhirData, answerQuestion: answerQuestionText },
    )

    let followUpContent = ""
    const followUpToolResults: Array<{ toolName: string; result: unknown }> = []
    const maxFollowUpAttempts = shouldPreExecute ? 2 : 1
    // Only a deliberately routed, sole compact snapshot is a complete lookup.
    // A prefetched medication search or inventory must not end a multi-domain
    // investigation before the model can query Patient, labs and encounters.
    const snapshotOnly = shouldPreExecute && initialToolName === 'getHealthSummarySnapshot'
      && Object.keys(tools ?? {}).length === 1
    for (let attempt = 0; attempt < maxFollowUpAttempts; attempt += 1) {
      const requestController = shouldPreExecute ? new AbortController() : abortController
      const forwardAbort = () => requestController.abort()
      if (shouldPreExecute) {
        if (abortController.signal.aborted) requestController.abort()
        abortController.signal.addEventListener('abort', forwardAbort, { once: true })
      }
      try {
        const followUpResult = await streamText({
          model,
          messages: followUpMessages as ModelMessage[],
          tools: snapshotOnly ? undefined : tools,
          stopWhen: [stepCountIs(MAX_TOOL_STEPS), repeatedToolCallIs(3)],
          ...reasoningOptions,
          abortSignal: requestController.signal,
        })

        for await (const chunk of withIdleTimeout(
          followUpResult.fullStream,
          idleMs,
          () => requestController.abort(),
          abortController.signal,
        )) {
          if (chunk.type === "text-delta") {
            followUpContent += chunk.text
            emit({ type: "content", content: followUpContent })
          } else if (chunk.type === "tool-call") {
            const displayName = getToolDisplayName(chunk.toolName, t.toolNames)
            if (!usedToolNames.includes(chunk.toolName)) usedToolNames.push(chunk.toolName)
            trajectory.push({
              round: 2,
              kind: "tool-call",
              toolName: chunk.toolName,
              input: (chunk as { input?: unknown }).input,
            })
            emit({
              type: "tool-call",
              toolName: chunk.toolName,
              state: `🔍 ${displayName}...`,
              toolCalls: [...usedToolNames],
            })
          } else if (chunk.type === "tool-result") {
            const chunkAny = chunk as any
            const toolResult = chunkAny.result ?? chunkAny.output ?? chunkAny.toolResult ?? chunkAny
            followUpToolResults.push({ toolName: chunk.toolName, result: toolResult })
            trajectory.push({ round: 2, kind: "tool-result", toolName: chunk.toolName, result: toolResult })
            emit({ type: "tool-result", toolName: chunk.toolName, result: toolResult })
          } else if (chunk.type === "error") {
            throw (chunk as { error?: unknown }).error ?? new Error("AI stream error")
          }
        }
        addUsage(await followUpResult.usage)
        break
      } catch (error) {
        const mayRetry = shouldPreExecute && attempt + 1 < maxFollowUpAttempts &&
          followUpContent.length === 0 && !abortController.signal.aborted
        if (!mayRetry) throw error
        emit({ type: 'status', state: `📝 ${t.organizingResults}` })
      } finally {
        if (shouldPreExecute) {
          abortController.signal.removeEventListener('abort', forwardAbort)
        }
      }
    }

    // Round 3 — synthesis: follow-up itself called tools but still emitted no text.
    if (followUpToolResults.length > 0 && followUpContent.length === 0) {
      emit({ type: "status", state: `📝 ${t.organizingResults}` })

      const { summary: finalToolSummary } =
        processAgentStreamUseCase.buildToolResultsSummary(followUpToolResults, summaryTranslations)

      const finalMessages = [
        ...followUpMessages,
        { role: "user" as const, content: `${finalToolSummary}\n\n${t.synthesizeResults}` },
      ]

      const finalResult = await streamText({
        model,
        messages: finalMessages as ModelMessage[],
        ...reasoningOptions,
        abortSignal: abortController.signal,
      })

      let finalContent = ""
      for await (const chunk of withIdleTimeout(finalResult.fullStream, idleMs, onStreamIdle)) {
        if (chunk.type === "text-delta") {
          finalContent += chunk.text
          emit({ type: "content", content: finalContent })
        } else if (chunk.type === "error") {
          throw (chunk as { error?: unknown }).error ?? new Error("AI stream error")
        }
      }
      addUsage(await finalResult.usage)

      followUpContent = finalContent
    }

    if (followUpContent.length > 0) {
      trajectory.push({ round: 2, kind: "text", text: followUpContent })
    }

    // Literature search can happen in EITHER round; merge citations from both so
    // the Sources list survives regardless of which round produced them.
    const followUpCitations = processAgentStreamUseCase.buildToolResultsSummary(
      followUpToolResults,
      summaryTranslations,
    ).citations
    const allLiteratureCitations = [...new Set([...literatureCitations, ...followUpCitations])]

    let finalDisplayContent = followUpContent
    if (allLiteratureCitations.length > 0) {
      const { processedContent } = processAgentStreamUseCase.processCitations({
        content: followUpContent,
        citations: allLiteratureCitations,
      })
      finalDisplayContent = processedContent
    }
    finalDisplayContent = repeatNote(finalDisplayContent)

    emit({
      type: "final",
      content: finalDisplayContent,
      toolCalls: usedToolNames.length > 0 ? usedToolNames : [],
    })

    return {
      answer: finalDisplayContent,
      toolCalls: usedToolNames,
      citations: allLiteratureCitations,
      trajectory,
      usage,
    }
  }

  // Direct path — the model answered in one shot while calling tools; just
  // post-process any literature citations.
  if (toolResults.length > 0 && accumulatedContent.length > 0) {
    const { citations: literatureCitations } =
      processAgentStreamUseCase.buildToolResultsSummary(toolResults, summaryTranslations)

    if (literatureCitations.length > 0) {
      const { processedContent } = processAgentStreamUseCase.processCitations({
        content: accumulatedContent,
        citations: literatureCitations,
      })
      emit({ type: "content", content: processedContent })
      return {
        answer: processedContent,
        toolCalls: usedToolNames,
        citations: literatureCitations,
        trajectory,
        usage,
      }
    }

    return { answer: accumulatedContent, toolCalls: usedToolNames, citations: [], trajectory, usage }
  }

  return { answer: accumulatedContent, toolCalls: usedToolNames, citations: [], trajectory, usage }
}
