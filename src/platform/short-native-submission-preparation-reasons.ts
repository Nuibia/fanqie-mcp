/** Local prepare diagnostics only; never platform text or preparation authority. */
const MESSAGES = Object.freeze({
  cover_required: '投稿准备未通过：尚未设置推荐封面。保存封面后，重新读取版本并准备。',
  categories_invalid: '投稿准备未通过：分类未满足要求。请检查主分类及已选分类后重新准备。',
  title_invalid: '投稿准备未通过：主标题未满足要求。请检查标题后重新准备。',
  recommended_title_invalid: '投稿准备未通过：备选标题未满足要求。请检查备选标题后重新准备。',
  trial_required: '投稿准备未通过：试读设置或其正文条件未满足要求。请检查后重新准备。',
  signed_min_text: '投稿准备未通过：当前授权分支的正文长度条件未满足要求。请在平台检查。',
  unresolved_review_problem: '投稿准备未通过：草稿仍有待处理的问题标记。请在平台查看并处理。',
  state_not_draft: '投稿准备未通过：当前作品不是可准备投稿的草稿状态。请重新核对状态。',
  source_version_mismatch: '投稿准备未通过：当前内容版本与请求不一致。请重新读取版本后准备。',
  source_observation_stale: '投稿准备未通过：本次使用的来源观察已过期。请重新准备。',
  activity_branch_unsupported: '投稿准备未通过：当前活动分支尚不受此能力支持。请在平台处理。',
  story_origin_branch_unsupported:
    '投稿准备未通过：当前作品来源分支尚不受此能力支持。请在平台处理。',
  authorize_branch_unsupported: '投稿准备未通过：当前授权分支尚不受此能力支持。请在平台处理。',
  categories_unsupported: '投稿准备未通过：当前分类规则格式尚不受此能力支持。',
  trial_document_unsupported: '投稿准备未通过：当前试读文档格式尚不受此能力支持。',
  content_unsupported: '投稿准备未通过：当前正文格式尚不受此能力支持。',
});
export type NativeShortPreparationReason = keyof typeof MESSAGES;
export const NATIVE_SHORT_PREPARATION_REASONS: readonly NativeShortPreparationReason[] =
  Object.freeze(Object.keys(MESSAGES) as NativeShortPreparationReason[]);
export function isNativeShortPreparationReason(
  value: unknown,
): value is NativeShortPreparationReason {
  return typeof value === 'string' && Object.hasOwn(MESSAGES, value);
}
export function nativeShortPreparationDiagnostic(reason: NativeShortPreparationReason) {
  // Runtime callers may still be untyped; never index a supplied arbitrary key.
  if (!isNativeShortPreparationReason(reason)) throw new Error('Invalid preparation diagnostic');
  return Object.freeze({
    code: 'capability_unavailable' as const,
    message: MESSAGES[reason],
    details: Object.freeze({ reason, diagnosticStatus: 'reported-not-verified' as const }),
  });
}
