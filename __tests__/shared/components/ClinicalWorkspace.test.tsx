/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { Stethoscope } from "lucide-react"

import { Tabs } from "@/components/ui/tabs"
import {
  ClinicalMobilePanelSwitcher,
  ClinicalTabContentFrame,
  ClinicalTabList,
  ClinicalTabTrigger,
  ClinicalWorkspaceDivider,
  ClinicalWorkspaceMain,
  ClinicalWorkspacePanel,
  ClinicalWorkspaceRoot,
} from "@/src/shared/components/clinical-workspace"

describe("ClinicalWorkspace primitives", () => {
  it("follows the keyboard-safe visual viewport without leaving the visible screen", () => {
    const { container } = render(
      <ClinicalWorkspaceRoot>workspace</ClinicalWorkspaceRoot>,
    )

    const workspace = container.querySelector(
      '[data-slot="clinical-workspace"]',
    )
    expect(workspace).toHaveClass("relative")
    expect(workspace).toHaveStyle({
      height: "var(--app-viewport-height, 100svh)",
      top: "var(--app-viewport-offset-top, 0px)",
    })
  })

  it("uses one quiet center seam instead of stacking panel outlines", () => {
    const { container } = render(
      <ClinicalWorkspaceMain>
        <ClinicalWorkspacePanel
          mobileActive
          desktopState="split"
          desktopWidth="50%"
        />
        <ClinicalWorkspaceDivider
          label="Resize panels"
          onDragStart={jest.fn()}
          onCollapseLeft={jest.fn()}
          onCollapseRight={jest.fn()}
          leftCollapseLabel="Collapse left"
          rightCollapseLabel="Collapse right"
        />
        <ClinicalWorkspacePanel
          mobileActive={false}
          desktopState="split"
          desktopWidth="49.5%"
        />
      </ClinicalWorkspaceMain>,
    )

    // Flush panels: no gutter and no padding, one hairline seam between them.
    const main = container.querySelector('[data-slot="clinical-workspace-main"]')
    expect(main).not.toHaveClass("md:gap-1")
    expect(main).not.toHaveClass("p-1")
    container
      .querySelectorAll('[data-slot="clinical-workspace-panel"]')
      .forEach((panel) => expect(panel).not.toHaveClass("md:border"))
    expect(
      container.querySelectorAll(
        '[data-slot="clinical-workspace-divider-line"]',
      ),
    ).toHaveLength(1)
  })

  it("keeps every feature tab on the same professional content gutter", () => {
    const { container } = render(
      <ClinicalTabContentFrame>tab content</ClinicalTabContentFrame>,
    )

    const frame = container.querySelector(
      '[data-slot="clinical-tab-content-frame"]',
    )
    expect(frame).toHaveClass("px-3")
    expect(frame).toHaveClass("sm:px-4")
  })

  it("keeps inactive phone panels responsive without the extension-prone hidden class", () => {
    const { container } = render(
      <ClinicalWorkspacePanel
        mobileActive={false}
        desktopState="split"
        desktopWidth="48%"
      >
        clinical content
      </ClinicalWorkspacePanel>,
    )

    const panel = container.querySelector(
      '[data-slot="clinical-workspace-panel"]',
    )
    expect(panel).toHaveClass("max-md:hidden")
    expect(panel).toHaveClass("bg-panel")
    expect(panel).not.toHaveClass("hidden")
    expect(panel).toHaveStyle({ width: "48%" })
  })

  it("preserves both collapse actions and the drag start behavior", () => {
    const onDragStart = jest.fn()
    const onCollapseLeft = jest.fn()
    const onCollapseRight = jest.fn()
    const { container } = render(
      <ClinicalWorkspaceDivider
        label="Resize panels"
        onDragStart={onDragStart}
        onCollapseLeft={onCollapseLeft}
        onCollapseRight={onCollapseRight}
        leftCollapseLabel="Collapse clinical summary"
        rightCollapseLabel="Collapse features"
      />,
    )

    expect(
      screen.getByRole("separator", { name: "Resize panels" }),
    ).toBeInTheDocument()
    fireEvent.mouseDown(
      container.querySelector(".cursor-col-resize") as HTMLElement,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse clinical summary" }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse features" }),
    )

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onCollapseLeft).toHaveBeenCalledTimes(1)
    expect(onCollapseRight).toHaveBeenCalledTimes(1)
  })

  it("uses a labeled, two-state mobile panel switcher", () => {
    const onChange = jest.fn()
    render(
      <ClinicalMobilePanelSwitcher
        activePanel="left"
        leftLabel="Clinical summary"
        rightLabel="Features"
        onChange={onChange}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Clinical summary" }),
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      screen.getByRole("button", { name: "Clinical summary" }),
    ).toHaveClass("h-[40px]", "min-h-[40px]", "py-0")
    fireEvent.click(screen.getByRole("button", { name: "Features" }))
    expect(onChange).toHaveBeenCalledWith("right")
  })

  it("gives registered tabs one shared line-selected visual grammar", () => {
    render(
      <Tabs defaultValue="patient">
        <ClinicalTabList>
          <ClinicalTabTrigger
            value="patient"
            label="Patient"
            icon={Stethoscope}
          />
          <ClinicalTabTrigger value="reports" label="Reports" />
        </ClinicalTabList>
      </Tabs>,
    )

    const patient = screen.getByRole("tab", { name: "Patient" })
    const tabList = screen.getByRole("tablist")
    expect(patient).toHaveAttribute("data-state", "active")
    expect(patient).toHaveClass("rounded-none")
    expect(patient).toHaveClass("min-h-[40px]", "md:min-h-[44px]")
    expect(patient).toHaveClass("xl:min-h-10")
    expect(patient).toHaveClass("data-[state=active]:after:bg-foreground")
    expect(tabList).toHaveClass("xl:h-10")
    expect(tabList).toHaveClass("xl:min-h-10")
    expect(tabList).toHaveClass("min-h-[40px]", "md:min-h-[44px]")
  })
})
