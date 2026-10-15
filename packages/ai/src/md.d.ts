/** Prompt files are imported as text (Bun text loader), so they are bundled into compiled binaries. */
declare module "*.md" {
  const text: string;
  export default text;
}
