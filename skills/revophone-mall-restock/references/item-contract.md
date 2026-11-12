# 商品契约

已核对 RevoPhone 1.1.8 的 `ui/mall.js` 批量入口、`core/backend.js` 的 `importItems`、`core/xeno.js` 的 `normalizeCatalogItem` 和 `core/xeno-restock.js`。未来项目版本改变字段时，重新核对这些入口，不凭空更换格式。

## 文件与身份

```json
{
  "format": "revophone-mall-items",
  "version": 1,
  "exportedAt": "ISO-8601 时间",
  "count": 1,
  "items": [
    {
      "id": "restock_稳定编号",
      "name": "雾行披风",
      "shortName": "雾行披风",
      "category": "apparel",
      "slot": "outerwear",
      "price": 680,
      "source": "restock",
      "listed": true,
      "gender": "",
      "summary": "适合雨雾天气的轻便旅行披风。",
      "appearance": "灰蓝面料，银色扣环，兜帽边缘有细密纹样。",
      "abilities": "减轻细雨对衣物的浸湿。",
      "abilityConditions": "仅限细雨；不能抵挡浸泡或暴雨。",
      "drawPrompt": "hooded cloak, blue gray fabric, silver clasp"
    }
  ]
}
```

这是结构示例，按用户需求创作，正式 ID 由打包脚本生成。脚本输出不写 `owned`、`imageData`、`storyPurchaseId`、`storyCraftId`、`sourceTargetName`。新物品归为 `restock`，在售但未购买；重导同 ID 会更新资料并保留本地已有购买状态和配图。这个行为依赖默认的**增量导入**；覆盖替换进货会先移除原进货集合，不能当成安全更新方式。

同 ID 更新原条目；无匹配 ID 时，商城还会按 `category:name` 借用旧商品字段。不同 ID 的同分类同名物品容易产生重复和意外继承，因此批内拒绝同名，提供完整目录时也检查冲突。修改现有进货使用原 ID；新设计不要借用内置、自制或转化装备的 ID。

目录最多保留 200 件，包含内置商品和衣柜库存。导入器可能截断超出的商品；脚本发现已知超限时拒绝生成，未提供完整目录时不能保证剩余空间。

## 分类与必填项

所有商品必填 `name`、`category`、`price`。价格为 0–999999 的整数。新 ID 可省略，简称可省略，由名称生成。

| category | 含义 | slot | 补充要求 |
| --- | --- | --- | --- |
| `skin_suit` | 皮躯 | `skin_suit` | 身体／结构字段按设定填写 |
| `flesh_ring` | 肉躯 | `flesh_ring` | 分别填写静息及前后延展 |
| `apparel` | 服饰与饰品 | `outerwear`、`underwear`、`privacyCover`、`accessories` | 明确选择一个槽位 |
| `consumable` | 异构道具 | `consumable` | 必填现有效果 `effectKind` |

道具效果只有：

- `cognition`：以简介 `summary` 为内容添加角色认知规则。
- `body`：运行程序现有的固定身体改造，不按任意描述生成新的数值行为。
- `physiology`：运行程序现有的固定生理效果，同样不是通用脚本。

用户要自定义行为而现有程序不支持时，标明只是剧情设定；不要把标签或简介写成已实现的功能。

## 身体、能力与声音

- `gender`：`男`、`女`、`扶她` 或空字符串。打包时显式保留空字符串，避免导入器对省略值采用旧版默认类型。
- `lowerBodyMode`：`replace` 使用本件结构；`preserve` 保留内层／本体；`legacy` 只用于保留旧装备语义。新商品未指定时打包为 `replace`。
- `lowerBodyType`：`auto`、`female`、`male`、`dual`、`none`、`custom`。`auto` 跟随身体类型，其他值为独立结构；说明写在 `lowerBodyDescription`。
- `abilities` 记录能力，`abilityConditions` 记录触发、限制及代价。穿戴类装备实际穿戴后向剧情提供，脱下后停止；不是额外数值引擎。
- `ringAppearance` 为肉躯静息外观，`forwardExtension`／`backwardExtension` 为两个独立方向的设定。实际覆盖仍受方向、头部及部位开关控制，不能宣称一上架就改变角色。
- `voiceRole` 仅复用用户提供的真实绑定引用；不要按音色描述虚构引擎或 ID。省略时保留已有绑定。用户明确清空时可写空字符串，脚本随之写入 `voiceRoleExplicit:true`。
- `drawPrompt` 是角色／外观生图标签（一律不加 `futanari`），`organDrawPrompt` 是肉棒／前方延展生图标签（存在时固定以 `futanari` 开头），`drawPromptOpen` 是服饰展开时使用的标签。应与设计的身体类型和比例一致，不混用多个姿势。
- `rawDesign` 可保存完整设定或 XML，但**不是导入必需项**。优先确保结构化字段完整，避免只写 XML 导致名称、外貌、能力和标签缺失。

## 长度上限

超过上限时导入器会截断，脚本改为报错，先压缩正文再交付。

| 字段 | 最多字符（按程序 JS 字符串长度） |
| --- | ---: |
| `id` | 120 |
| `name` | 160 |
| `shortName` | 80 |
| `summary` | 400 |
| `appearance`、`bodyBuild`、`physiology` | 各 1000 |
| `ringAppearance` | 800 |
| `forwardExtension`、`backwardExtension`、`lowerBodyDescription` | 各 1000 |
| `abilities` | 4000 |
| `abilityConditions` | 2000 |
| `drawPrompt`、`drawPromptOpen` | 各 1500 |
| `voiceRole` | 4000 |
| `rawDesign` | 6000 |
