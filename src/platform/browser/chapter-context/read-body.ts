import { type BrowserContext } from 'playwright';

import { PlatformReadError } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';

import {
  type ChapterBodyRecord,
  buildChapterBodyReadCandidate,
  parseChapterBodyResponse,
  ChapterBodyCandidateError,
} from '../../chapter-body.js';
import { type ChapterReadState } from './chapterReadScope.js';

interface Ports {
  chapterReadScope: ChapterReadState;
  volumes: (import('../../reads.js').ChapterVolume & { index: number; name: string })[];
  ownedRequest: import('../../../../node_modules/playwright/index.js').APIRequestContext;
}
export function createBodyRead(ports: Ports) {
  return async () => {
    const matches = ports.chapterReadScope.collected!.records.filter(
      (row) =>
        row.workId === ports.chapterReadScope.workId &&
        row.chapterId === ports.chapterReadScope.collection!.bodyRead!.chapterId,
    );
    if (
      matches.length !== 1 ||
      !ports.volumes.some((volume) => volume.volumeId === matches[0]!.volumeId)
    )
      throw new PlatformReadError(
        'chapter_body_target_unverified',
        'One actual same-parent management chapter is required',
      );
    const requested = {
      workId: ports.chapterReadScope.workId,
      chapterId: matches[0]!.chapterId,
      volumeId: matches[0]!.volumeId,
    };
    let bodyResponse: Awaited<ReturnType<BrowserContext['request']['get']>> | undefined;
    let parsedBody: ChapterBodyRecord | null = null,
      bodyDisposed = false;
    try {
      ports.chapterReadScope.assertStable();
      const candidate = buildChapterBodyReadCandidate(ports.chapterReadScope.frozenUrl, requested);
      // Independent public-contract authority: never add this URL to a
      // page/CDP source registry or invent signatures and hidden params.
      bodyResponse = await ports.ownedRequest.get(candidate.url, {
        maxRedirects: 0,
        maxRetries: 0,
        failOnStatusCode: false,
        timeout: Math.max(
          1,
          Math.min(
            ports.chapterReadScope.timeout,
            ports.chapterReadScope.collection!.bodyRead!.deadline - performance.now(),
          ),
        ),
        ...(ports.chapterReadScope.options.signal
          ? { signal: ports.chapterReadScope.options.signal }
          : {}),
      });
      ports.chapterReadScope.assertStable();
      const status = bodyResponse.status();
      if (
        bodyResponse.url() !== candidate.url ||
        !bodyResponse.ok() ||
        !Number.isInteger(status) ||
        status < 200 ||
        status >= 300
      )
        throw new PlatformReadError(
          'chapter_body_response_unverified',
          'The single-target GET did not return its exact successful response',
        );
      const payload: unknown = await bodyResponse.json();
      ports.chapterReadScope.assertStable();
      parsedBody = parseChapterBodyResponse(payload, requested);
    } catch (error) {
      if (error instanceof ChapterBodyCandidateError)
        throw new PlatformReadError(
          'chapter_body_candidate_unverified',
          'The fixed author-edit response or URL candidate changed',
        );
      throw error;
    } finally {
      if (bodyResponse) {
        let stale = false;
        try {
          ports.chapterReadScope.assertStable();
        } catch {
          stale = true;
        }
        try {
          await bodyResponse.dispose();
          bodyDisposed = true;
        } catch {
          throw new PlatformReadError(
            'chapter_body_disposal_failed',
            'The single-target response was not disposed',
          );
        }
        ports.chapterReadScope.assertStable();
        if (stale)
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The body read lost its canonical boundary',
          );
      }
    }
    ports.chapterReadScope.assertStable();
    if (!bodyDisposed || !parsedBody)
      throw new PlatformReadError(
        'chapter_body_response_unverified',
        'The single-target response was not verified',
      );
    ports.chapterReadScope.bodyBuffer = parsedBody;
  };
}
