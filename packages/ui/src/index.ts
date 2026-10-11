/**
 * @learncroc/ui — design tokens (tokens.css, theme.css, fonts.css), primitives, motion presets,
 * the sound engine and the world theme provider.
 */
export {
  type AnnounceOptions,
  announce,
  clearAnnouncements,
  LIVE_MIN_GAP_MS,
  LIVE_REPEAT_MS,
  resetLiveRegion,
} from "./a11y/live";
export { cn } from "./cn";
export {
  contrast,
  hexToRgb,
  luminance,
  mix,
  mixToContrast,
  rgbToHex,
  type WorldVars,
  worldInk,
  worldVars,
} from "./color";
export { CROC_SIZES, CROC_STATES, Croc, type CrocProps, type CrocState } from "./croc/Croc";
export { CrocBubble, type CrocBubbleProps } from "./croc/CrocBubble";
export { isTypingTarget } from "./keys";
export {
  durations,
  easings,
  type MotionPreset,
  prefersReducedMotion,
  reduced,
  springs,
  transition,
  useReducedMotion,
} from "./motion";
export { AnswerKey, type AnswerKeyProps } from "./primitives/AnswerKey";
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  buttonClass,
  KbdHint,
} from "./primitives/Button";
export { ConfidenceTap, type ConfidenceTapProps } from "./primitives/ConfidenceTap";
export { Dialog, type DialogProps } from "./primitives/Dialog";
export { Drawer, type DrawerProps } from "./primitives/Drawer";
export { IrisMark, type IrisMarkProps } from "./primitives/IrisMark";
export { Kbd, type KbdProps } from "./primitives/Kbd";
export { Menu, MenuItem, type MenuItemProps, type MenuProps } from "./primitives/Menu";
export {
  Modal,
  type ModalAnchor,
  type ModalCloseReason,
  type ModalProps,
  type ModalSize,
  useModal,
} from "./primitives/Modal";
export { Panel, type PanelProps } from "./primitives/Panel";
export { GateCharge, type GateChargeProps, type PipState, Pips, type PipsProps } from "./primitives/Pips";
export { Popover, type PopoverProps } from "./primitives/Popover";
export { ProgressBeads, type ProgressBeadsProps } from "./primitives/ProgressBeads";
export { Segmented, type SegmentedProps } from "./primitives/Segmented";
export { SegmentRing, type SegmentRingProps } from "./primitives/SegmentRing";
export { StatePill, type StatePillProps } from "./primitives/StatePill";
export { StopGlyph, type StopGlyphProps } from "./primitives/StopGlyph";
export { Switch, type SwitchProps } from "./primitives/Switch";
export { type EntryKind, GATE_LABEL, STATE_LABEL, stateLabel } from "./primitives/states";
export { dismissToast, Toast, Toaster, type ToastItem, type ToastProps, toast } from "./primitives/Toast";
export { WhyThisWorks, type WhyThisWorksProps } from "./primitives/WhyThisWorks";
export {
  CUE_GAP_MS,
  CUE_MS,
  createSoundEngine,
  PENTATONIC,
  SOUND_CUES,
  type SoundCue,
  type SoundEngine,
  type SoundEngineOptions,
} from "./sound";
export { WorldTheme, type WorldThemeProps } from "./WorldTheme";
