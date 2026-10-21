"use client"

import { useEffect, useId, useRef, useState } from 'react'
import type { PointDecision } from './visit-decisions'
import { checkIntervalSuffix, isUnranked } from './visit-decisions'
import type { QueueStep } from './visit-decisions'
import type { DecisionPointView, VisitAction } from '../../types'
import styles from './VisitBookLayout.module.css'

/**
 * After 「改」 the line that held it is gone; focus goes on to what the
 * clinician decides next in the same box or row — its recommendation, else
 * its first button — rather than falling to the page.
 */
function clearAndRefocus(button: HTMLElement, clear: () => void) {
  const holder = button.closest<HTMLElement>('[data-book-box], [data-book-dp]')
  clear()
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body && holder?.contains(document.activeElement)) return
    const next = holder?.querySelector<HTMLElement>('[data-visit-primary]:not([disabled])')
      ?? holder?.querySelector<HTMLElement>('button:not([disabled])')
    next?.focus()
  })
}

/** The prototype's check mark: a stroke, never an icon font or emoji. */
function Tick({ small = false }: { small?: boolean }) {
  const size = small ? 14 : 16
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.tick}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/**
 * A point's decision on the pocket-handbook page, drawn as the Artifact
 * prototype 「CDSS 小麻式版面原型」 draws it (owner request 2026-09-30: 「都
 * 照著 CDSS 小麻式版面原型，不要使用任何原本的外觀」): the recommendation as
 * the one filled button, the rest beside it or, when there are three or more,
 * behind 「其他」 opening in place; once recorded, ✓ the choice, 「改」, and
 * what to recheck. Every word on a button is the pack's; the record is the
 * same one the map's controls write.
 */
export function BookDecisionControls({
  point,
  decision,
  isEnglish,
  onDecide,
  onClear,
  safety,
}: {
  point: DecisionPointView
  decision?: PointDecision
  isEnglish: boolean
  onDecide?: (action: VisitAction) => void
  onClear?: () => void
  /**
   * A safety row (the pack's `QueueRow.safety`, set by the chain's head): its
   * recommendation is the red button on every step, not only on a step whose
   * own state is safety. Without a row, the point's own state decides.
   */
  safety?: boolean
}) {
  const otherId = useId()
  const [otherOpen, setOtherOpen] = useState(false)
  const decidedRef = useRef<HTMLParagraphElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hadDecision = useRef(Boolean(decision))
  const [primary, ...others] = point.actions
  const readOnly = !onDecide

  // The buttons a decision was taken with go; focus follows to the line that
  // now states it rather than falling to the page.
  useEffect(() => {
    const was = hadDecision.current
    hadDecision.current = Boolean(decision)
    if (was || !decision) return
    const active = document.activeElement
    if (!active || active === document.body || containerRef.current?.contains(active)) decidedRef.current?.focus()
  }, [decision])

  if (decision) {
    const check = decision.record.responseCheck
    return (
      <div ref={containerRef} className={styles.decided} data-testid="cdss-visit-decided">
        <p ref={decidedRef} tabIndex={-1} className={styles.decidedLine} data-visit-decided={decision.action.id}>
          <Tick />
          <span className="sr-only">{isEnglish ? 'Decided: ' : '已決定：'}</span>
          <b>{decision.record.actionLabel ?? decision.action.label}</b>
          {onClear ? (
            <button
              type="button"
              className={styles.change}
              onClick={(event) => clearAndRefocus(event.currentTarget, onClear)}
              aria-label={isEnglish ? `Change the decision on ${point.dp}` : `改 ${point.dp} 的決定`}
              data-visit-change={point.dp}
            >
              {isEnglish ? 'Change' : '改'}
            </button>
          ) : null}
        </p>
        {check ? (
          <p className={styles.decidedCheck} data-visit-response-check="">
            {check.text}{checkIntervalSuffix(check, isEnglish)}
          </p>
        ) : null}
        {decision.record.reopenWhen ? (
          <p className={styles.decidedCheck}>{isEnglish ? 'Reopen when: ' : '重新評估：'}{decision.record.reopenWhen}</p>
        ) : null}
      </div>
    )
  }

  if (!primary) return null
  const decide = (action: VisitAction) => onDecide?.(action)

  // A question's answers (懷疑 HF？ 是／否) and equals the pack ranks none of
  // (the four DOACs, each at its dose) are all alike: no one made the obvious one.
  const question = point.actions.length > 1 && (isUnranked(point) || point.actions.every((action) => (
    action.physicianInput && action.physicianInput.request === primary.physicianInput?.request
  )))
  if (question) {
    return (
      <div ref={containerRef} className={styles.controls} data-testid="cdss-visit-controls" data-visit-question="">
        {point.actions.map((action, index) => (
          <button
            key={action.id}
            type="button"
            className={styles.btn}
            disabled={readOnly}
            onClick={() => decide(action)}
            data-visit-primary={index === 0 ? point.dp : undefined}
            data-visit-action={action.id}
          >
            {action.label}
          </button>
        ))}
      </div>
    )
  }

  const folded = others.length >= 3
  return (
    <div ref={containerRef} className={styles.controlsWrap} data-testid="cdss-visit-controls">
      <div className={styles.controls}>
        <button
          type="button"
          className={(safety ?? point.state === 'safety') ? styles.priSafety : styles.pri}
          disabled={readOnly}
          onClick={() => decide(primary)}
          data-visit-primary={point.dp}
          data-visit-action={primary.id}
        >
          {primary.label}
        </button>
        {folded ? (
          <button
            type="button"
            className={styles.btn}
            aria-expanded={otherOpen}
            aria-controls={otherId}
            onClick={() => setOtherOpen((open) => !open)}
            data-visit-other={point.dp}
          >
            {isEnglish ? 'Other' : '其他'}
          </button>
        ) : others.map((action) => (
          <button key={action.id} type="button" className={styles.btn} disabled={readOnly} onClick={() => decide(action)} data-visit-action={action.id}>
            {action.label}
          </button>
        ))}
      </div>
      {folded && otherOpen ? (
        <div id={otherId} role="group" aria-label={isEnglish ? `Other decisions for ${point.dp}` : `${point.dp} 的其他決定`} className={styles.others}>
          {others.map((action) => (
            <button key={action.id} type="button" className={styles.btn} disabled={readOnly} onClick={() => decide(action)} data-visit-action={action.id}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A chain's steps already taken today, one line each: ✓ the DP, what was
 * chosen and, where the page can take it back, 「改」 — so 開始抗凝 can still
 * become 暫緩 once a DOAC is chosen (owner request 2026-10-01: 「第一步旁邊也
 * 加『改』」). Taking a step back takes the steps that followed from it too.
 */
export function BookChainDone({ steps, isEnglish = false, onClear }: {
  steps: readonly QueueStep[]
  isEnglish?: boolean
  onClear?: (step: QueueStep) => void
}) {
  return (
    <>
      {steps.map((step) => {
        const label = step.decision?.record.actionLabel ?? step.decision?.action.label
        return (
          <p key={step.key} className={styles.chainDone} data-visit-chain-done={step.point.dp}>
            <Tick small />
            <span className={styles.dpTag}>{step.point.dp}</span>
            <span>{label}</span>
            {onClear ? (
              <button
                type="button"
                className={styles.change}
                onClick={(event) => clearAndRefocus(event.currentTarget, () => onClear(step))}
                aria-label={isEnglish ? `Change ${step.point.dp}: ${label}` : `改 ${step.point.dp}：${label}`}
                data-visit-chain-change={step.key}
              >
                {isEnglish ? 'Change' : '改'}
              </button>
            ) : null}
          </p>
        )
      })}
    </>
  )
}
