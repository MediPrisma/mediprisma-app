// Renders a free-text hospital report (endoscopy, imaging, ECG, pathology) with
// an indented hierarchy instead of one wall of text. Parsing is delegated to the
// pure `formatReportText` helper; this component only maps the parsed lines to
// layout (heading vs item, indentation by level, marker column).
import { cn } from "@/src/shared/utils/cn.utils"
import { formatReportText } from "@/src/shared/utils/report-text-format"
import { buttonVariants } from "@/components/ui/button"

interface FormattedReportTextProps {
  text: string
  className?: string
}

// Indentation per nesting level. Headings (level 0 + heading) stay flush-left;
// items/sub-items step in. Kept modest so deeply-nested reports don't run off
// the right edge in the narrow card/dialog widths.
const INDENT_BY_LEVEL: Record<number, string> = {
  0: '',
  1: 'pl-3',
  2: 'pl-7',
  3: 'pl-10',
}

export function FormattedReportText({ text, className }: FormattedReportTextProps) {
  const lines = formatReportText(text)
  if (lines.length === 0) return null

  return (
    <div className={cn('@container/report space-y-1', className)}>
      {lines.map((line, i) => {
        if (line.separator) {
          return <div key={i} aria-hidden="true" className="my-2 border-t border-border" />
        }
        if (line.measurement) {
          // Keep consecutive source fields together, in row-major source order.
          // Use the report's width, not the viewport: the right pane can be narrow
          // even on a desktop monitor.
          if (lines[i - 1]?.measurement) return null
          const measurements = []
          for (let j = i; j < lines.length && lines[j].measurement; j++) {
            measurements.push(lines[j].measurement!)
          }
          return (
            <dl key={i} className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm leading-5 tabular-nums @min-[36rem]/report:grid-cols-2">
              {measurements.map((measurement, index) => (
                <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-x-2 py-0.5">
                  <dt className="min-w-0 break-words font-medium text-foreground">{measurement.label}</dt>
                  <dd className="min-w-0 break-words">{measurement.value}</dd>
                </div>
              ))}
            </dl>
          )
        }
        if (line.heading) {
          // first:mt-0 so the very first heading doesn't add a leading gap.
          return (
            <div key={i} className={cn("mt-2 flex gap-1.5 first:mt-0", INDENT_BY_LEVEL[line.level])}>
              {line.marker && (
                <span className="shrink-0 text-muted-foreground" aria-hidden="true">{line.marker}</span>
              )}
              {line.headingLabel ? (
                <p className="min-w-0 break-words">
                  <span className="font-semibold text-foreground">{line.headingLabel}</span>
                  {line.text.slice(line.headingLabel.length)}
                </p>
              ) : (
                <p className="font-semibold text-foreground">{line.text}</p>
              )}
            </div>
          )
        }
        if (line.tableCells) {
          return (
            <div key={i} className={cn('flex min-w-0 gap-1.5', INDENT_BY_LEVEL[line.level])}>
              {line.marker && (
                <span className="shrink-0 tabular-nums text-muted-foreground">{line.marker}</span>
              )}
              <div className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-max border-collapse text-sm tabular-nums">
                  <tbody>
                    <tr className="divide-x divide-border">
                      {line.tableCells.map((cell, cellIndex) => cellIndex === 0 ? (
                        <th key={cellIndex} scope="row" className="bg-muted/50 px-2.5 py-1.5 text-left font-semibold text-foreground">
                          {cell}
                        </th>
                      ) : (
                        <td key={cellIndex} className="px-2.5 py-1.5 text-center text-foreground">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        }
        return (
          <div key={i} className={cn('flex gap-1.5', INDENT_BY_LEVEL[line.level])}>
            {line.marker && (
              <span className="shrink-0 tabular-nums text-muted-foreground">{line.marker}</span>
            )}
            <span className={cn(
              'min-w-0 flex-1 break-words',
              line.monospace && 'overflow-x-auto whitespace-pre font-mono tabular-nums',
            )}>{line.text}</span>
          </div>
        )
      })}
      <details className="group/raw min-w-0 pt-2">
        <summary
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-11 cursor-pointer list-none text-muted-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden')}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="group-open/raw:hidden">顯示原始報告</span>
          <span className="hidden group-open/raw:inline">收起原始報告</span>
        </summary>
        <div role="region" aria-label="原始報告" className="mt-2 min-w-0 rounded-md border border-border bg-muted/30 p-3">
          <pre className="m-0 whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{text}</pre>
        </div>
      </details>
    </div>
  )
}
