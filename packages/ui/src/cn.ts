import { type ClassValue, clsx } from "clsx";

/** Join class names (clsx). */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
