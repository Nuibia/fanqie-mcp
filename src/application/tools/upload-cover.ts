import { coverUploadSchema } from '../shared.js';
import { type ToolOperation, type ReceiveCoverOperation } from '../contracts/tool-input.js';

interface Dependencies {
  tool: ToolOperation;
  receiveCover: ReceiveCoverOperation;
}

export function registerUploadCoverTool(deps: Dependencies): void {
  deps.tool(
    'upload_cover',
    '接收PNG/JPEG/WebP封面文件到本机受控目录，返回uploadPath、sha256和size；不访问平台、不创建任务，图片签名不代表平台封面有效性。',
    coverUploadSchema,
    false,
    async (args) => deps.receiveCover(args),
  );
}
