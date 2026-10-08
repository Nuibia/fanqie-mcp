import { type Page, type Request } from 'playwright';

interface Ports {
  page: Page;
  workId: string;
}
export function createVolumeRequestMatcher(ports: Ports) {
  return (request: Request): boolean => {
    try {
      if (
        request.method() !== 'GET' ||
        !['xhr', 'fetch'].includes(request.resourceType()) ||
        request.frame() !== ports.page.mainFrame()
      )
        return false;
      const url = new URL(request.url());
      if (
        url.origin !== 'https://fanqienovel.com' ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== '/api/author/volume/volume_list/v1'
      )
        return false;
      if (
        new Set(url.searchParams.keys()).size !== url.searchParams.size ||
        url.searchParams.getAll('book_id').length !== 1 ||
        url.searchParams.get('book_id') !== ports.workId
      )
        return false;
      return ![...url.searchParams.keys()].some((key) =>
        /^(?:author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id|bookId|work_id|workId)$/i.test(
          key,
        ),
      );
    } catch {
      return false;
    }
  };
}
