/**
 * Keeps an optional surface (the AI layer, the Ask input) from taking the map down with it: if a slot
 * throws, it renders nothing and the map stays usable.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export class SlotBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(`${this.props.name} failed; the map carries on without it.`, error, info.componentStack);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
