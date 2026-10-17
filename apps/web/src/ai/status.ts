/** The AI status query (configured, cap reached, Ollama detected), shared by Settings, Create and Moss. */
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys } from "../api/hooks";

export function useAiStatusQuery() {
  return useQuery({ queryKey: queryKeys.aiStatus, queryFn: () => api.getAiStatus(), staleTime: 15_000, retry: false });
}
