"use client";

import { useEffect, useRef, useState } from "react";
import { readPipelineWork } from "@/app/actions";
import { pipelineUnavailable, type PipelineCursor, type PipelineLoan, type PipelinePage, type PipelineQuery } from "@/lib/pipeline-model";
import type { Stage } from "@/lib/model";

function appendLoans(current: PipelineLoan[], incoming: PipelineLoan[]) {
  const unique = new Map(current.map((loan) => [loan.id, loan]));
  for (const loan of incoming) unique.set(loan.id, loan);
  return [...unique.values()];
}

export function usePipeline(brokerageId: string, active: boolean, query: PipelineQuery, version: object) {
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ query: PipelineQuery; version: object; retry: number; result: PipelinePage | { error: string }; moreError?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const paging = useRef(false);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void readPipelineWork(query, brokerageId).catch(() => ({ error: pipelineUnavailable })).then((result) => {
        if (current) setData({ query, version, retry, result });
      });
    }, query.search ? 180 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [active, brokerageId, query, version, retry]);

  const current = data?.query === query && data.version === version && data.retry === retry ? data : undefined;
  const result = current?.result;
  const page = result && !("error" in result) ? result : undefined;
  async function loadMore(after: PipelineCursor, lane?: Stage) {
    if (paging.current || !current || !page) return;
    paging.current = true;
    setLoadingMore(true);
    try {
      const extra = await readPipelineWork({ ...query, after, lane }, brokerageId).catch(() => ({ error: pipelineUnavailable }));
      setData((latest) => {
        if (latest !== current) return latest;
        if ("error" in extra) return { ...current, moreError: extra.error };
        const addedLane = extra.lanes[0];
        return { ...current, moreError: undefined, result: { ...extra,
          lanes: lane && addedLane ? page.lanes.map((item) => item.stage === lane ?
            { ...addedLane, loans: appendLoans(item.loans, addedLane.loans) } : item) : page.lanes,
          list: lane ? page.list : { ...extra.list, loans: appendLoans(page.list.loans, extra.list.loans) },
        } };
      });
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  }
  const options = data && !("error" in data.result) ? data.result.options : undefined;
  return { page, options, error: result && "error" in result ? result.error : current?.moreError,
    loadingMore, loadMore, refresh: () => setRetry((value) => value + 1) };
}
