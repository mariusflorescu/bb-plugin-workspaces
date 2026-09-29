import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { closeEditor, queryClient } from "../src/client";

beforeEach(() => {
  queryClient.setDefaultOptions({ queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  localStorage.clear();
  act(() => closeEditor());
});
