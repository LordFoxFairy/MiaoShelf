/**
 * 标签。
 *
 * 为什么需要标签而不是只有分类：
 *  - 分类是"这个商品属于哪里"，一个商品只能有一个，用于前台导航
 *  - 标签是"这个商品有什么特点"，可以有多个，用于交叉筛选
 *
 * 几百个商品时，光靠分类找不动。标签能做到
 * 「GPT + 有货 + 低于 200 元」这种组合筛选。
 *
 * 存储用 JSON 字符串数组（SQLite 没有原生数组类型）。
 * 商品量在几千级别时，前端过滤足够快，不值得为此单开一张表。
 */

/** 标签规范化：去空格、去重、限长。避免「热卖」和「热卖 」被当成两个。 */
export function normalizeTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,，]/)
      : [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const tag = String(item).trim();
    if (!tag || tag.length > 20) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    // 一个商品挂太多标签就失去筛选意义了。
    if (result.length >= 12) break;
  }

  return result;
}

export function parseTags(stored: unknown): string[] {
  if (typeof stored !== "string") return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

/** 批量操作：给一批商品加/removed 标签，保留各自已有的其他标签。 */
export function applyTagOperation(
  current: string[],
  operation: "add" | "remove" | "replace",
  tags: string[],
): string[] {
  const incoming = normalizeTags(tags);

  switch (operation) {
    case "add":
      return normalizeTags([...current, ...incoming]);
    case "remove": {
      const removeSet = new Set(incoming);
      return current.filter((tag) => !removeSet.has(tag));
    }
    case "replace":
      return incoming;
  }
}

/**
 * 从一批商品里统计标签使用情况，供筛选器展示。
 * 按使用次数降序 —— 常用的排前面才好点。
 */
export interface TagCount {
  tag: string;
  count: number;
}

export function countTags(productTags: string[][]): TagCount[] {
  const counts = new Map<string, number>();

  for (const tags of productTags) {
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/**
 * 建议标签：从商品标题里提取常见特征词。
 *
 * 卡密类商品的标题信息量很大（「质保掉订阅」「官方直充」「美区」…），
 * 手工打标签几百个商品太累，先自动提一批候选让人确认。
 */
const KEYWORD_RULES: ReadonlyArray<[RegExp, string]> = [
  [/质保|保修|包赔/, "质保"],
  [/官方|正规/, "官方"],
  [/直充|直冲/, "直充"],
  [/成品|现货/, "成品"],
  [/共享|车位/, "共享"],
  [/独享|独立/, "独享"],
  [/年卡|年付|1年|一年/, "年卡"],
  [/季卡|季付/, "季卡"],
  [/月卡|月付|1个月|一个月/, "月卡"],
  [/周卡|7天/, "周卡"],
  [/美区|美国/, "美区"],
  [/港区|香港/, "港区"],
  [/日区|日本/, "日区"],
  [/土区|土耳其/, "土区"],
  [/菲区|菲律宾/, "菲区"],
  [/自动发货|秒发/, "秒发"],
];

export function suggestTags(title: string): string[] {
  const matched: string[] = [];
  for (const [pattern, tag] of KEYWORD_RULES) {
    if (pattern.test(title)) matched.push(tag);
  }
  return normalizeTags(matched);
}
