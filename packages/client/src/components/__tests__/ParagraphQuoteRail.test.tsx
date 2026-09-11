import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ParagraphQuoteRail } from "../ParagraphQuoteRail";

/**
 * An intersection observer that keeps the part of the real contract this
 * component's cost depends on: observing a target queues an initial
 * observation for it, delivered on a later frame whether or not anything
 * changed. A double whose `observe` is a bare spy hides the loop entirely.
 */
class QueueingIntersectionObserverMock {
  static instances: QueueingIntersectionObserverMock[] = [];
  readonly observed: Element[] = [];
  readonly callback: IntersectionObserverCallback;
  private queued: Element[] = [];
  private lastDelivered = new Map<Element, boolean>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    QueueingIntersectionObserverMock.instances.push(this);
  }

  observe = (target: Element) => {
    this.observed.push(target);
    this.queued.push(target);
    this.lastDelivered.delete(target);
  };

  unobserve = (target: Element) => {
    const index = this.observed.indexOf(target);
    if (index >= 0) this.observed.splice(index, 1);
    this.lastDelivered.delete(target);
  };

  disconnect = () => {
    this.observed.length = 0;
    this.queued.length = 0;
    this.lastDelivered.clear();
  };

  /**
   * Deliver what the browser would deliver on the next frame: the initial
   * observation for every newly observed target, plus every observed target
   * whose intersection actually changed. A target that was already observed
   * and did not change is delivered nothing, which is the property the rail
   * has to rely on to go quiet.
   */
  deliverFrame(isIntersecting: (target: Element) => boolean): number {
    const due = new Set(this.queued);
    this.queued = [];
    for (const target of this.observed) {
      if (this.lastDelivered.get(target) !== isIntersecting(target)) {
        due.add(target);
      }
    }
    if (due.size === 0) return 0;
    const entries = [...due].map((target) => {
      const state = isIntersecting(target);
      this.lastDelivered.set(target, state);
      return { target, isIntersecting: state } as IntersectionObserverEntry;
    });
    this.callback(entries, this as unknown as IntersectionObserver);
    return entries.length;
  }
}

function Harness() {
  const contentRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={surfaceRef} className="text-block">
      <ParagraphQuoteRail
        alwaysShowQuoteCircle={false}
        contentRef={contentRef}
        layoutKey="test"
        onQuoteBlock={() => {}}
        paragraphQuoteCirclesEnabled={true}
        sourceRef={contentRef}
        surfaceRef={surfaceRef}
      />
      <div ref={contentRef} className="text-block-content">
        <p>first paragraph</p>
        <p>second paragraph</p>
      </div>
    </div>
  );
}

function renderRail() {
  QueueingIntersectionObserverMock.instances.length = 0;
  vi.stubGlobal("IntersectionObserver", QueueingIntersectionObserverMock);
  render(
    <I18nProvider>
      <Harness />
    </I18nProvider>,
  );
  const observer = QueueingIntersectionObserverMock.instances[0];
  if (!observer) throw new Error("The rail did not create an observer");
  return observer;
}

describe("ParagraphQuoteRail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("settles instead of re-arming while its block is off screen", () => {
    const observer = renderRail();
    const observesAfterMount = observer.observed.length;

    // Five frames in which the block never enters the scrollport. A rail that
    // reasserts parking re-observes its surface on every one of them, and each
    // re-observation schedules another measurement, so the page never idles.
    let deliveredAfterFirstFrame = 0;
    for (let frame = 0; frame < 5; frame++) {
      const delivered = observer.deliverFrame(() => false);
      if (frame > 0) deliveredAfterFirstFrame += delivered;
    }

    expect(observesAfterMount).toBe(1);
    expect(deliveredAfterFirstFrame).toBe(0);
  });

  it("observes its blocks when the block is on screen, and again after it returns", () => {
    const observer = renderRail();
    const surface = document.querySelector(".text-block");
    if (!surface) throw new Error("Missing surface");

    observer.deliverFrame((target) => target === surface);
    // The surface plus both paragraphs.
    expect(observer.observed.length).toBe(3);

    // Scrolling away parks the rail back onto its surface alone.
    observer.deliverFrame(() => false);
    expect(observer.observed).toEqual([surface]);

    // Returning re-arms block observation rather than staying parked.
    observer.deliverFrame((target) => target === surface);
    expect(observer.observed.length).toBe(3);
  });
});
