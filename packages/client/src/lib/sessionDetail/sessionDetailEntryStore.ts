import type { SessionRouteScrollSnapshot } from "../sessionRouteSnapshots";
import { cloneScrollSnapshot } from "./sessionDetailSnapshots";
import { createInitialSessionDetailState } from "./transcriptReducer";
import type { SessionDetailState } from "./types";

export type SessionDetailSelector<T> = (
  state: SessionDetailState | undefined,
) => T;
export type SessionDetailEquality<T> = (left: T, right: T) => boolean;

interface SelectorSubscription {
  selector: SessionDetailSelector<unknown>;
  listener: () => void;
  equality: SessionDetailEquality<unknown>;
  value: unknown;
}

export class SessionDetailEntryStore {
  private stateValue: SessionDetailState | undefined;
  private subscriptions = new Set<SelectorSubscription>();

  get hasSubscriptions(): boolean {
    return this.subscriptions.size > 0;
  }

  get state(): SessionDetailState | undefined {
    return this.stateValue;
  }

  initialize(state: SessionDetailState): void {
    if (!this.stateValue) {
      this.stateValue = state;
    }
  }

  replaceState(state: SessionDetailState): void {
    this.stateValue = state;
    this.notify();
  }

  patchScrollSnapshot(
    scrollSnapshot: SessionRouteScrollSnapshot,
    notify: boolean,
  ): boolean {
    if (!this.stateValue) {
      return false;
    }
    this.stateValue = {
      ...this.stateValue,
      scrollSnapshot: cloneScrollSnapshot(scrollSnapshot),
    };
    if (notify) {
      this.notify();
    }
    return true;
  }

  resetState(): boolean {
    if (!this.stateValue) {
      return false;
    }
    this.stateValue = createInitialSessionDetailState();
    this.notify();
    return true;
  }

  clear(): boolean {
    if (!this.stateValue) {
      return false;
    }
    this.stateValue = undefined;
    this.notify();
    return true;
  }

  subscribe<T>(
    selector: SessionDetailSelector<T>,
    listener: () => void,
    equality: SessionDetailEquality<T>,
  ): () => void {
    const subscription: SelectorSubscription = {
      selector: selector as SessionDetailSelector<unknown>,
      listener,
      equality: equality as SessionDetailEquality<unknown>,
      value: selector(this.state),
    };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  private notify(): void {
    for (const subscription of Array.from(this.subscriptions)) {
      const nextValue = subscription.selector(this.stateValue);
      if (subscription.equality(subscription.value, nextValue)) {
        continue;
      }
      subscription.value = nextValue;
      subscription.listener();
    }
  }
}
