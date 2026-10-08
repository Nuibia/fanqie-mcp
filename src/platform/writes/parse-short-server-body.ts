import { type Page, type Locator } from 'playwright';

import { unavailable, editorUrl } from './is-generic-short-capture-failure.js';

import { type UiWriteProfile, type WriteTarget } from './hash-draft-content.js';

import { assertShortReadTarget } from './unique.js';

export async function parseShortServerBody(page: Page, html: string): Promise<string> {
  if (html.includes('\0') || html.length > 3_000_000 || Buffer.byteLength(html, 'utf8') > 3_000_000)
    unavailable('The complete native short server content exceeded its supported extent.');
  const body = await page.evaluate((raw) => {
    if (raw === '') return '';
    // Validate the exact grammar before parsing: HTML repair must never turn an
    // unsupported source into a seemingly complete paragraph document.
    if (!/^(?:<p>(?:[^<>]|<br>|<br\/>|<br \/>)*<\/p>)+$/.test(raw)) return null;
    const template = document.createElement('template');
    template.innerHTML = raw;
    const paragraphs: string[] = [];
    for (const node of Array.from(template.content.childNodes)) {
      if (node.nodeType !== 1) return null;
      const p = node as Element;
      if (p.tagName !== 'P' || p.attributes.length !== 0) return null;
      let text = '';
      for (const child of Array.from(p.childNodes)) {
        if (child.nodeType === 3) text += child.textContent ?? '';
        else if (
          child.nodeType === 1 &&
          (child as Element).tagName === 'BR' &&
          (child as Element).attributes.length === 0 &&
          child.childNodes.length === 0
        )
          text += '\n';
        else return null;
      }
      paragraphs.push(text);
    }
    return paragraphs.join('\n');
  }, html);
  if (
    typeof body !== 'string' ||
    body.includes('\0') ||
    body.length > 3_000_000 ||
    Buffer.byteLength(body, 'utf8') > 3_000_000
  )
    unavailable('The native short server body was outside the supported plain paragraph format.');
  return body;
}

export async function discardShortLocalCache(
  page: Page,
  profile: UiWriteProfile,
  target: WriteTarget,
  deadline: number,
): Promise<void> {
  const dialogs = page
      .getByRole('dialog', { includeHidden: true })
      .filter({ has: page.getByText('有刚刚更新的草稿，是否继续编辑？', { exact: true }) }),
    count = await dialogs.count();
  assertShortReadTarget(page, profile, target);
  if (count === 0) return;
  if (count !== 1 || performance.now() >= deadline)
    unavailable('The current editor cache prompt was ambiguous or expired.');
  const caption = dialogs.getByText('有刚刚更新的草稿，是否继续编辑？', { exact: true });
  if ((await caption.count()) !== 1)
    unavailable('The visible editor prompt was not the observed draft cache confirmation.');
  assertShortReadTarget(page, profile, target);
  if (!(await caption.isVisible())) unavailable('The observed cache confirmation was not visible.');
  assertShortReadTarget(page, profile, target);
  const discard = dialogs.getByRole('button', { name: '放弃', exact: true, includeHidden: true });
  if ((await discard.count()) !== 1) unavailable('The cache discard control was not unique.');
  assertShortReadTarget(page, profile, target);
  if (!(await discard.isVisible())) unavailable('The cache discard control was not visible.');
  assertShortReadTarget(page, profile, target);
  if (!(await discard.isEnabled())) unavailable('The cache discard control was disabled.');
  assertShortReadTarget(page, profile, target);
  const dialog = await dialogs.elementHandle();
  let button: Awaited<ReturnType<typeof discard.elementHandle>> | null = null;
  try {
    assertShortReadTarget(page, profile, target);
    button = await discard.elementHandle();
    assertShortReadTarget(page, profile, target);
    if (
      !dialog ||
      !button ||
      !(await button.evaluate(
        (node, original) =>
          original.isConnected &&
          node.isConnected &&
          original.contains(node) &&
          original.getAttribute('role') === 'dialog' &&
          node.closest('[role="dialog"]') === original &&
          Array.from(original.querySelectorAll('*')).filter(
            (element) =>
              element.childElementCount === 0 &&
              element.textContent?.trim() === '有刚刚更新的草稿，是否继续编辑？' &&
              element.closest('[role="dialog"]') === original,
          ).length === 1 &&
          node.tagName === 'BUTTON' &&
          node.textContent?.trim() === '放弃' &&
          !(node as HTMLButtonElement).disabled &&
          node.getAttribute('aria-disabled') !== 'true',
        dialog,
      ))
    )
      unavailable('The cache discard target changed before its action.');
    assertShortReadTarget(page, profile, target);
    if (performance.now() >= deadline) unavailable('The cache discard deadline expired.');
    await button.click({ timeout: Math.max(1, deadline - performance.now()) });
    assertShortReadTarget(page, profile, target);
  } finally {
    await button?.dispose();
    await dialog?.dispose();
  }
}

export async function assertShortEditorBinding(
  page: Page,
  body: Locator,
  profile: UiWriteProfile,
  target: WriteTarget,
): Promise<void> {
  assertShortReadTarget(page, profile, target);
  const valid = await body.evaluate(
    (root, destination) => {
      const win = root.ownerDocument.defaultView as
        | (Window & {
            adapter?: {
              view?: {
                dom?: unknown;
                state?: {
                  doc?: {
                    content?: { size?: unknown };
                    textBetween?: (
                      from: number,
                      to: number,
                      block: string,
                      leaf: string,
                    ) => unknown;
                  };
                };
              };
              setHTML?: unknown;
              getHTML?: unknown;
            };
          })
        | null;
      const adapter = win?.adapter,
        view = adapter?.view,
        doc = view?.state?.doc,
        size = doc?.content?.size;
      if (
        !root.isConnected ||
        win?.location.href !== destination ||
        view?.dom !== root ||
        !doc ||
        typeof adapter?.setHTML !== 'function' ||
        typeof adapter.getHTML !== 'function' ||
        typeof doc.textBetween !== 'function' ||
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < 0 ||
        size > 3_000_000
      )
        return false;
      const text = doc.textBetween(0, size, '\n', '\n');
      return (
        typeof text === 'string' &&
        text.length <= 3_000_000 &&
        !text.includes('\0') &&
        new TextEncoder().encode(text).length <= 3_000_000 &&
        win.adapter === adapter &&
        adapter.view === view &&
        view.state?.doc === doc &&
        view.dom === root &&
        doc.content?.size === size &&
        root.isConnected &&
        win.location.href === destination
      );
    },
    editorUrl(profile, target),
  );
  assertShortReadTarget(page, profile, target);
  if (!valid)
    unavailable('The native short editor APIs were not bound to the unique current document.');
}

export async function fillShortEditorDocument(
  page: Page,
  body: Locator,
  profile: UiWriteProfile,
  target: WriteTarget,
  source: string,
  deadline: number,
): Promise<string> {
  const html = source
    .split('\n')
    .map(
      (line) =>
        `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')}</p>`,
    )
    .join('');
  if (
    source.length > 3_000_000 ||
    Buffer.byteLength(source, 'utf8') > 3_000_000 ||
    html.length > 3_000_000 ||
    Buffer.byteLength(html, 'utf8') > 3_000_000
  )
    unavailable('The complete native short source exceeded its supported extent.');
  assertShortReadTarget(page, profile, target);
  if (performance.now() >= deadline) unavailable('The native short body action deadline expired.');
  const result = await body.evaluate(
    async (root, args) => {
      type Doc = {
        content?: { size?: unknown };
        textBetween?: (from: number, to: number, block: string, leaf: string) => unknown;
      };
      type View = { dom?: unknown; state?: { doc?: Doc } };
      type Adapter = {
        view?: View;
        setHTML?: (html: string, options: { silent: boolean; mergeEmpty?: boolean }) => unknown;
        getHTML?: () => unknown;
      };
      const currentWindow = root.ownerDocument.defaultView as
          (Window & { adapter?: Adapter }) | null,
        adapter = currentWindow?.adapter,
        view = adapter?.view;
      if (
        !root.isConnected ||
        view?.dom !== root ||
        !adapter ||
        typeof adapter.setHTML !== 'function' ||
        typeof adapter.getHTML !== 'function' ||
        currentWindow?.location.href !== args.destination
      )
        return null;
      await adapter.setHTML(args.html, { silent: false, mergeEmpty: false });
      const doc = view.state?.doc,
        size = doc?.content?.size;
      if (
        !root.isConnected ||
        currentWindow?.adapter !== adapter ||
        adapter.view !== view ||
        view.dom !== root ||
        currentWindow.location.href !== args.destination ||
        !doc ||
        typeof doc.textBetween !== 'function' ||
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < 0 ||
        size > 3_000_000
      )
        return null;
      const text = doc.textBetween(0, size, '\n', '\n'),
        encoded = adapter.getHTML();
      if (
        text !== args.source ||
        typeof encoded !== 'string' ||
        encoded.length > 3_000_000 ||
        encoded.includes('\0') ||
        currentWindow.adapter !== adapter ||
        adapter.view !== view ||
        view.dom !== root ||
        view.state?.doc !== doc ||
        doc.content?.size !== size ||
        !root.isConnected ||
        currentWindow.location.href !== args.destination
      )
        return null;
      return encoded;
    },
    { html, source, destination: editorUrl(profile, target) },
  );
  assertShortReadTarget(page, profile, target);
  if (
    typeof result !== 'string' ||
    Buffer.byteLength(result, 'utf8') > 3_000_000 ||
    performance.now() >= deadline
  )
    unavailable('The full native short document did not match the requested source.');
  const tail = result.lastIndexOf('<p></p>'),
    wireHTML = tail === -1 || tail + 7 < result.length ? result + '<p></p>' : result;
  const wireBody = await parseShortServerBody(page, wireHTML);
  assertShortReadTarget(page, profile, target);
  if (wireBody !== source || performance.now() >= deadline)
    unavailable('The native save representation would change the requested full body.');
  return wireHTML;
}
