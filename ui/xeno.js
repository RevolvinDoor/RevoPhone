// App 1: 异构终端 (xeno)
import {createView, esc, heading, help} from './common.js';
import {icon} from './icons.js';
import {
  GENDERS, POSSESSION_MODES, POSSESSION_WAYS, FUSION_MODES, FUSION_BRANCHES,
  VORE_CHANNELS, VORE_LOCATIONS, VORE_STATUSES, VORE_DIGESTIONS,
  TAIL_STATES, ORIFICE_SLOTS, ORIFICE_MOD_TYPES, VENOM_TYPES, WORLD_CARRIERS,
  PRESET_COGNITION_RULES, effectiveEntityView, getEntity, computeFusionGender
} from '../core/xeno.js';

export function xenoApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'xeno');
  let showProtDetail = false;
  let showTargetDetail = false;
  let activeTab = 'possession'; // 'possession' | 'fusion' | 'parasite' | 'vore' | 'mod'
  let modSubTab = 'body'; // 'body' | 'cognition'
  let entryWay = '近距锁定';
  let chosenPossMode = '浅层共鸣';
  let chosenFusionMode = '共存融合';
  let chosenFusionBranch = '正常分离';
  let vorePredatorKey = '__protagonist__';
  let voreChannel = '口腔';
  let voreLocation = '胃部';
  let settingsOpen = false;

  const xenoState = () => api.getState().xeno;
  const unsubscribe = api.subscribe(e => {
    if (e?.type === 'xeno' || e?.type === 'settings') v.refresh();
  });
  const origDispose = v.dispose.bind(v);
  v.dispose = () => { unsubscribe?.(); origDispose(); };

  function renderStatusBarCard({title, badge, entity, view, isProt, detailOpen, targetList = [], selectedTarget = ''}) {
    const toggleAction = isProt ? 'toggle-prot-detail' : 'toggle-target-detail';
    const editAction = isProt ? 'edit-prot' : 'edit-target';
    return `
      <section class="xeno-status-card ${isProt ? 'prot' : 'target'}">
        <header class="xeno-status-head">
          <div class="xeno-status-title">
            <span class="xeno-badge ${isProt ? 'prot' : 'target'}">${esc(badge)}</span>
            <strong>${esc(title)}</strong>
          </div>
          <div class="xeno-status-actions">
            ${isProt ? `<button type="button" class="xeno-mini-btn" data-action="sync-story" ${api.xenoBusy?.('sync') ? 'disabled' : ''}>${api.xenoBusy?.('sync') ? '同步中…' : '从剧情同步'}</button>` : ''}
            <button type="button" class="xeno-mini-btn" data-action="${editAction}">编辑</button>
            <button type="button" class="xeno-mini-btn ${detailOpen ? 'active' : ''}" data-action="${toggleAction}">${detailOpen ? '收起详情' : '详情'}</button>
          </div>
        </header>
        ${!isProt ? `
          <div class="xeno-target-bar">
            <select class="xeno-select" data-change="select-target" aria-label="选择目标角色">
              ${targetList.length
                ? targetList.map(t => `<option value="${esc(t.name)}" ${t.name === selectedTarget ? 'selected' : ''}>🎯 目标：${esc(t.name)}（${esc(t.identity)} · ${esc(t.gender)}）</option>`).join('')
                : '<option value="">（暂无目标角色，请点击右侧新增或从剧情同步）</option>'}
            </select>
            <div class="xeno-target-btns">
              <button type="button" class="xeno-mini-btn primary" data-action="add-target">+ 新增</button>
              ${entity ? `<button type="button" class="xeno-mini-btn danger" data-action="delete-target" data-name="${esc(entity.name)}">删除</button>` : ''}
            </div>
          </div>
        ` : ''}
        ${entity ? `
          <div class="xeno-vertical-list">
            <div class="xeno-kv"><span class="k">姓名</span><span class="v"><b>${esc(view.name)}</b></span></div>
            <div class="xeno-kv"><span class="k">身份</span><span class="v">${esc(view.identity)}</span></div>
            <div class="xeno-kv"><span class="k">性别</span><span class="v"><i class="xeno-gender-tag" data-gender="${esc(view.gender)}">${esc(view.gender)}</i></span></div>
            <div class="xeno-kv"><span class="k">外貌特征</span><span class="v">${esc(view.appearance)}</span></div>
            <div class="xeno-kv"><span class="k">体型身材</span><span class="v">${esc(view.bodyBuild)}</span></div>
            <div class="xeno-kv"><span class="k">生理特征</span><span class="v">${esc(view.physiology)}</span></div>
          </div>
          ${detailOpen ? `
            <div class="xeno-detail-list">
              <div class="xeno-detail-divider"><span>深层映射与挂载详情（8项）</span></div>
              <div class="xeno-kv detail"><span class="k">原始肉体</span><span class="v">${esc(view.originalBody)}</span></div>
              <div class="xeno-kv detail"><span class="k">当前肉体</span><span class="v">${esc(view.currentBody)}</span></div>
              <div class="xeno-kv detail"><span class="k">变更原因</span><span class="v">${esc(view.changeReason)}</span></div>
              <div class="xeno-kv detail"><span class="k">托管状态</span><span class="v">${esc(view.hostingState)}</span></div>
              <div class="xeno-kv detail"><span class="k">皮躯/肉躯挂载</span><span class="v">${esc(view.livingMountText)}</span></div>
              <div class="xeno-kv detail"><span class="k">四槽位着装</span><span class="v">${esc(view.outfitText)}</span></div>
              <div class="xeno-kv detail"><span class="k">体内收纳</span><span class="v">${esc(view.voreText)}</span></div>
              <div class="xeno-kv detail"><span class="k">认知状态</span><span class="v">${esc(view.cognitionText)}</span></div>
            </div>
          ` : ''}
        ` : `<p class="xeno-empty-note">当前未选定目标角色。可点击上方「+ 新增」手动添加，或点击「从剧情同步」/「洞察推荐」自动扫描登场角色。</p>`}
      </section>
    `;
  }

  function renderPossessionModule(xeno, curTarget) {
    const p = xeno.possession;
    const busyInsight = api.xenoBusy?.('insight');
    const modeDescriptions = {
      '浅层共鸣': '潜伏态：目标原本意识主导身体且毫无察觉，主角同步共享视觉/听觉/触觉/高潮与心声',
      '意识共存': '拘禁态：主角完全接管身体控制权，目标意识清醒被困在脑海深处，可随时精神对话调教',
      '完全占据': '沉睡态：主角绝对支配身体与生理机能，目标意识强制沉睡，脱离后失去期间记忆',
      '认知覆盖': '扭曲态：主角操控身体做出任何事，目标意识清醒却坚信一切言行皆出于自身真实意愿'
    };
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>附身之术</strong>
          <span class="xeno-state-pill ${p.active ? 'on' : ''}">${p.active ? `附身中：${esc(p.targetName)}（${esc(p.mode)}）` : '未发动（意识在本体）'}</span>
        </div>
        ${p.active ? `
          <div class="xeno-active-banner">
            <p><b>当前附身目标：</b>${esc(p.targetName)} ｜ <b>切入途径：</b>${esc(p.entryWay)}</p>
            <p class="sub">${esc(modeDescriptions[p.mode] || '')}</p>
            <div class="xeno-chip-group">
              ${POSSESSION_MODES.map(m => `<button type="button" class="xeno-chip ${p.mode === m ? 'active' : ''}" data-action="poss-switch-mode" data-mode="${esc(m)}">${esc(m)}</button>`).join('')}
            </div>
            <div class="xeno-row-controls">
              <button type="button" class="xeno-btn ${p.organSync ? 'accent' : 'secondary'}" data-action="poss-organ-sync">
                ${p.organSync ? '🔥 器官同步：已激活（扶她化）' : '⚪ 器官同步：未激活（点击生长本体器官）'}
              </button>
              <button type="button" class="xeno-btn danger" data-action="poss-release">脱离附身（认知篡改结算）</button>
            </div>
            ${['完全占据', '认知覆盖'].includes(p.mode) ? `
              <div class="xeno-swap-box">
                <span>⚡ <b>永久肉体互换</b>（仅完全占据/认知覆盖可用，双方原始本体永久对调）：</span>
                <div class="xeno-row-controls">
                  <button type="button" class="xeno-btn warn" data-action="poss-swap" data-swap="both">双重认知合理化互换</button>
                  <button type="button" class="xeno-btn secondary" data-action="poss-swap" data-swap="outer">仅外界合理化（目标自知换体）</button>
                </div>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="xeno-form-block">
            <div class="xeno-label">1. 选择切入途径</div>
            <div class="xeno-chip-group">
              ${POSSESSION_WAYS.map(w => `<button type="button" class="xeno-chip ${entryWay === w ? 'active' : ''}" data-action="poss-way" data-way="${esc(w)}">${esc(w)}</button>`).join('')}
            </div>
            ${entryWay === '洞察推荐' ? `
              <div class="xeno-insight-box">
                <div class="xeno-row-between">
                  <span>扫描当前剧情在场女性，生成颜值与附身价值评估：</span>
                  <button type="button" class="xeno-btn primary" data-action="poss-insight" ${busyInsight ? 'disabled' : ''}>
                    ${busyInsight ? '正在扫描剧情…' : '🔍 扫描生成评估报告'}
                  </button>
                </div>
                ${p.insightReports.length ? `
                  <div class="xeno-report-list">
                    ${p.insightReports.map(r => `
                      <div class="xeno-report-card">
                        <div class="xeno-report-head">
                          <strong>${esc(r.name)}</strong>
                          <small>${esc(r.identity)} · ${esc(r.gender)}</small>
                          <span class="xeno-score">颜值 <b>${esc(r.faceScore)}</b> / 身材 <b>${esc(r.bodyScore)}</b></span>
                        </div>
                        <p><b>外貌：</b>${esc(r.appearance)}</p>
                        <p><b>身材：</b>${esc(r.bodyBuild)}</p>
                        <p><b>价值剖析：</b>${esc(r.valueAnalysis)}</p>
                        <div class="xeno-row-between">
                          <small class="rec">推荐：${esc(r.recommendation)}</small>
                          <button type="button" class="xeno-mini-btn primary" data-action="poss-from-report" data-name="${esc(r.name)}">锁定并附身</button>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                ` : '<p class="xeno-hint">点击上方「扫描生成评估报告」，AI 将自动分析当前剧情中的高颜值目标并登记到状态栏。</p>'}
              </div>
            ` : ''}
            <div class="xeno-label">2. 选择附身状态（直接按名称切换）</div>
            <div class="xeno-chip-group">
              ${POSSESSION_MODES.map(m => `<button type="button" class="xeno-chip ${chosenPossMode === m ? 'active' : ''}" data-action="poss-pick-mode" data-mode="${esc(m)}">${esc(m)}</button>`).join('')}
            </div>
            <p class="xeno-hint">${esc(modeDescriptions[chosenPossMode] || '')}</p>
            <div class="xeno-row-controls">
              <button type="button" class="xeno-btn primary full" data-action="poss-start" ${!curTarget ? 'disabled' : ''}>
                ${curTarget ? `对【${esc(curTarget.name)}】发动附身（${esc(entryWay)} · ${esc(chosenPossMode)}）` : '请先在上方目标状态栏选择或新增目标'}
              </button>
            </div>
          </div>
        `}
        <div class="xeno-sub-box">
          <div class="xeno-label">⚓ 永久意识锚点（曾附身过的目标可无视距离随时切入）</div>
          ${p.anchors.length ? `
            <div class="xeno-anchor-list">
              ${p.anchors.map(a => `
                <div class="xeno-anchor-row">
                  <div><strong>${esc(a.name)}</strong><small>${esc(a.note)}</small></div>
                  <div class="xeno-anchor-btns">
                    <button type="button" class="xeno-mini-btn primary" data-action="poss-anchor-jump" data-name="${esc(a.name)}">远程切入</button>
                    <button type="button" class="xeno-mini-btn danger" data-action="poss-anchor-del" data-name="${esc(a.name)}">×</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<p class="xeno-hint">尚无永久意识锚点。首次附身任意目标后将自动在此留下永久锚点。</p>'}
        </div>
      </div>
    `;
  }

  function renderFusionModule(xeno, curTarget) {
    const f = xeno.fusion;
    const previewGender = curTarget ? computeFusionGender(xeno.protagonist.gender, curTarget.gender) : '扶她';
    const fusionDesc = {
      '浅层融合': '潜伏态：身体合二为一，由目标意志主导行动且毫无察觉，主角全感官同步共享',
      '共存融合': '拘禁态：主角主导融合躯体（可随时将控制权交接给目标），目标意识清醒可在脑内交流',
      '完全融合': '沉睡态：主角绝对支配融合躯体，目标意识沉睡，解除后无融合期记忆',
      '认同融合': '扭曲态：主角操控融合躯体，目标意识清醒但坚信一切行为皆出于自己本心'
    };
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>融合之术</strong>
          <span class="xeno-state-pill ${f.active ? 'on' : ''}">${f.active ? `融合中：${esc(f.targetName)}（${esc(f.mode)}）` : '未融合'}</span>
        </div>
        ${f.active ? `
          <div class="xeno-active-banner">
            <p><b>当前融合对象：</b>${esc(f.targetName)} ｜ <b>融合性别：</b>${esc(f.resultingGender)} ｜ <b>控制权：</b>${esc(f.controller)}</p>
            <p class="sub">${esc(fusionDesc[f.mode] || '')}</p>
            <div class="xeno-chip-group">
              ${FUSION_MODES.map(m => `<button type="button" class="xeno-chip ${f.mode === m ? 'active' : ''}" data-action="fusion-switch-mode" data-mode="${esc(m)}">${esc(m)}</button>`).join('')}
            </div>
            <div class="xeno-row-controls">
              <button type="button" class="xeno-btn secondary" data-action="fusion-toggle-ctrl">
                🔄 控制权交接（当前：${esc(f.controller)}）
              </button>
            </div>
            <div class="xeno-swap-box">
              <span>⚡ <b>解除融合与形态转化分支</b>（皮躯化/肉躯化将自动存入【衣柜】App）：</span>
              <div class="xeno-row-controls">
                <button type="button" class="xeno-btn secondary" data-action="fusion-release" data-branch="正常分离">正常分离</button>
                <button type="button" class="xeno-btn accent" data-action="fusion-release" data-branch="皮躯化">转化为【皮躯】存入衣柜</button>
                <button type="button" class="xeno-btn warn" data-action="fusion-release" data-branch="肉躯化">凝缩为【肉躯】存入衣柜</button>
              </div>
            </div>
          </div>
        ` : `
          <div class="xeno-form-block">
            <div class="xeno-label">1. 选择融合状态</div>
            <div class="xeno-chip-group">
              ${FUSION_MODES.map(m => `<button type="button" class="xeno-chip ${chosenFusionMode === m ? 'active' : ''}" data-action="fusion-pick-mode" data-mode="${esc(m)}">${esc(m)}</button>`).join('')}
            </div>
            <p class="xeno-hint">${esc(fusionDesc[chosenFusionMode] || '')}</p>
            <div class="xeno-label">2. 融合体态与性别预览</div>
            <p class="xeno-hint">
              ${curTarget
                ? `与【${esc(curTarget.name)}（${esc(curTarget.gender)}）】融合后显性性别为 <b>${esc(previewGender)}</b>，身材曲线将在双方基础上进一步丰满优化（乳量、腰臀比、敏感度全面提升）。`
                : '请先在顶部目标状态栏选择一名融合目标。'}
            </p>
            <div class="xeno-label">3. 预设解除分支</div>
            <div class="xeno-chip-group">
              ${FUSION_BRANCHES.map(b => `<button type="button" class="xeno-chip ${chosenFusionBranch === b ? 'active' : ''}" data-action="fusion-pick-branch" data-branch="${esc(b)}">${esc(b)}</button>`).join('')}
            </div>
            <div class="xeno-row-controls">
              <button type="button" class="xeno-btn primary full" data-action="fusion-start" ${!curTarget ? 'disabled' : ''}>
                ${curTarget ? `与【${esc(curTarget.name)}】发动肉体融合（${esc(chosenFusionMode)}）` : '请先选择目标角色'}
              </button>
            </div>
          </div>
        `}
      </div>
    `;
  }

  function renderParasiteModule() {
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>寄生之术</strong>
          <span class="xeno-state-pill">预留槽位</span>
        </div>
        <div class="xeno-reserved-box">
          <p>🧬 <b>【寄生之术 · 模块预留位】</b></p>
          <p class="sub">当前槽位已按架构预留，待后续设定细化后可直接在此接入共生/幼体/巢穴寄生玩法。</p>
        </div>
      </div>
    `;
  }

  function renderVoreModule(xeno, curTarget) {
    const allPeople = [
      ['__protagonist__', `主角：${xeno.protagonist.name}`],
      ...xeno.targets.map(t => [t.name, `目标：${t.name}`])
    ];
    const predator = getEntity(xeno, vorePredatorKey) || xeno.protagonist;
    const preyDefault = curTarget && curTarget.name !== predator.name ? curTarget.name : (xeno.targets.find(t => t.name !== predator.name)?.name || '');
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>丸吞之术 · 体内收纳</strong>
          <span class="xeno-state-pill ${predator.voreStorage.length ? 'on' : ''}">当前体内收纳：${predator.voreStorage.length} 人</span>
        </div>
        <div class="xeno-form-block">
          <div class="xeno-grid-2">
            <label class="xeno-field-inline">
              <span>捕食者（吞噬方）</span>
              <select class="xeno-select" data-change="vore-predator">
                ${allPeople.map(([k, label]) => `<option value="${esc(k)}" ${vorePredatorKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
              </select>
            </label>
            <label class="xeno-field-inline">
              <span>猎物（被吞方）</span>
              <input type="text" class="xeno-input" id="xeno-vore-prey" value="${esc(preyDefault)}" placeholder="输入或使用当前选定目标">
            </label>
          </div>
          <div class="xeno-label">吞噬通道</div>
          <div class="xeno-chip-group">
            ${VORE_CHANNELS.map(c => `<button type="button" class="xeno-chip ${voreChannel === c ? 'active' : ''}" data-action="vore-channel" data-channel="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
          <div class="xeno-label">体内收纳位置</div>
          <div class="xeno-chip-group">
            ${VORE_LOCATIONS.map(loc => `<button type="button" class="xeno-chip ${voreLocation === loc ? 'active' : ''}" data-action="vore-loc" data-loc="${esc(loc)}">${esc(loc)}</button>`).join('')}
          </div>
          <div class="xeno-row-controls">
            <button type="button" class="xeno-btn primary full" data-action="vore-start">
              👄 发动丸吞：将猎物经由【${esc(voreChannel)}】吞入【${esc(voreLocation)}】
            </button>
          </div>
        </div>
        <div class="xeno-sub-box">
          <div class="xeno-label">📦 体内收纳（${esc(predator.name)}）</div>
          ${predator.voreStorage.length ? `
            <div class="xeno-vore-list">
              ${predator.voreStorage.map(item => `
                <div class="xeno-vore-item">
                  <div class="xeno-row-between">
                    <strong>猎物：${esc(item.preyName)}</strong>
                    <small>经由 ${esc(item.channel)} → <b>${esc(item.location)}</b></small>
                  </div>
                  <div class="xeno-grid-2">
                    <label class="xeno-field-inline">
                      <span>收纳位置</span>
                      <select class="xeno-select" data-change="vore-item-loc" data-id="${esc(item.id)}">
                        ${VORE_LOCATIONS.map(l => `<option value="${esc(l)}" ${item.location === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="xeno-field-inline">
                      <span>挣扎与意识状态</span>
                      <select class="xeno-select" data-change="vore-item-status" data-id="${esc(item.id)}">
                        ${VORE_STATUSES.map(s => `<option value="${esc(s)}" ${item.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                      </select>
                    </label>
                  </div>
                  <label class="xeno-field-inline">
                    <span>消化与把玩进度</span>
                    <select class="xeno-select" data-change="vore-item-digest" data-id="${esc(item.id)}">
                      ${VORE_DIGESTIONS.map(d => `<option value="${esc(d)}" ${item.digestion === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
                    </select>
                  </label>
                  <div class="xeno-row-controls">
                    <button type="button" class="xeno-mini-btn secondary" data-action="vore-release" data-id="${esc(item.id)}">排出体外（恢复自由）</button>
                    <button type="button" class="xeno-mini-btn danger" data-action="vore-digest" data-id="${esc(item.id)}">彻底消化吸收</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<p class="xeno-hint">当前体内收纳为空。</p>'}
        </div>
      </div>
    `;
  }

  function renderModModule(xeno) {
    const allPeople = [
      ['__protagonist__', `主角肉体：${xeno.protagonist.name}`],
      ...xeno.targets.map(t => [t.name, `目标肉体：${t.name}`])
    ];
    const targetKey = xeno.modTarget || '__protagonist__';
    const entity = getEntity(xeno, targetKey) || xeno.protagonist;
    const cog = entity.cognitionState;
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>改造（肉体改造 & 认知修改）</strong>
          <select class="xeno-select compact" data-change="mod-select-target" aria-label="选择改造对象">
            ${allPeople.map(([k, label]) => `<option value="${esc(k)}" ${targetKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="xeno-subtabs">
          <button type="button" class="xeno-subtab ${modSubTab === 'body' ? 'active' : ''}" data-action="mod-subtab" data-sub="body">🧬 肉体改造（含丸吞尾）</button>
          <button type="button" class="xeno-subtab ${modSubTab === 'cognition' ? 'active' : ''}" data-action="mod-subtab" data-sub="cognition">🧠 认知修改</button>
        </div>
        ${modSubTab === 'body' ? `
          <div class="xeno-form-block">
            <div class="xeno-label">基础性别改造</div>
            <div class="xeno-chip-group">
              ${GENDERS.map(g => `<button type="button" class="xeno-chip ${entity.gender === g ? 'active' : ''}" data-action="mod-gender" data-gender="${esc(g)}">${esc(g)}</button>`).join('')}
            </div>
            <label class="xeno-field-inline">
              <span>外貌特征改造</span>
              <textarea class="xeno-textarea" id="xeno-mod-appearance" rows="2">${esc(entity.appearance)}</textarea>
            </label>
            <label class="xeno-field-inline">
              <span>体型身材改造（胸围/腰臀/身高）</span>
              <textarea class="xeno-textarea" id="xeno-mod-body" rows="2">${esc(entity.bodyBuild)}</textarea>
            </label>
            <label class="xeno-field-inline">
              <span>生理特征改造（器官尺寸/敏感度/体质）</span>
              <textarea class="xeno-textarea" id="xeno-mod-phys" rows="2">${esc(entity.physiology)}</textarea>
            </label>
            <div class="xeno-label">🦎 丸吞尾（异化捕食尾 · 挂载于尾椎）</div>
            <div class="xeno-chip-group">
              ${TAIL_STATES.map(([val, label]) => `<button type="button" class="xeno-chip ${entity.predatorTail === val ? 'active' : ''}" data-action="mod-tail" data-tail="${esc(val)}">${esc(label)}</button>`).join('')}
            </div>
            <div class="xeno-label">🌺 吞噬孔洞活性异化（局部微操）</div>
            <div class="xeno-grid-2">
              ${ORIFICE_SLOTS.map(([slotKey, slotLabel]) => `
                <label class="xeno-field-inline">
                  <span>${esc(slotLabel)}</span>
                  <select class="xeno-select" data-change="mod-orifice" data-slot="${esc(slotKey)}">
                    ${ORIFICE_MOD_TYPES.map(t => `<option value="${esc(t)}" ${entity.orificeMods[slotKey] === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                  </select>
                </label>
              `).join('')}
              <label class="xeno-field-inline">
                <span>生物侵入针注入液</span>
                <select class="xeno-select" data-change="mod-venom">
                  ${VENOM_TYPES.map(vt => `<option value="${esc(vt)}" ${entity.orificeMods.venomType === vt ? 'selected' : ''}>${esc(vt)}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="xeno-row-controls">
              <button type="button" class="xeno-btn primary full" data-action="mod-save-body">💾 保存并应用对【${esc(entity.name)}】的肉体改造</button>
            </div>
          </div>
        ` : `
          <div class="xeno-form-block">
            <label class="xeno-field-inline">
              <span>对主角关系与身份认知覆写</span>
              <input type="text" class="xeno-input" id="xeno-cog-relation" value="${esc(cog.relationOverride)}" placeholder="例如：坚信主角是自己绝对服从的唯一主人 / 挚爱丈夫">
            </label>
            <label class="xeno-field-inline">
              <span>植入虚假记忆</span>
              <textarea class="xeno-textarea" id="xeno-cog-memory" rows="2" placeholder="例如：深信自己从小就习惯在主角面前裸露侍奉…">${esc(cog.fakeMemory)}</textarea>
            </label>
            <div class="xeno-row-controls">
              <button type="button" class="xeno-btn primary full" data-action="mod-save-cog">💾 保存关系认知与虚假记忆</button>
            </div>
            <div class="xeno-label">📜 常识改写词条（潜意识法则覆写）</div>
            <div class="xeno-row-controls">
              <input type="text" class="xeno-input" id="xeno-cog-new-rule" placeholder="输入一条新的常识改写规则…">
              <button type="button" class="xeno-btn secondary" data-action="mod-add-rule">+ 添加词条</button>
            </div>
            <div class="xeno-preset-rules">
              <small>快捷植入预设常识：</small>
              ${PRESET_COGNITION_RULES.map(r => `<button type="button" class="xeno-mini-btn" data-action="mod-preset-rule" data-rule="${esc(r)}">+ ${esc(r.slice(0, 18))}…</button>`).join('')}
            </div>
            ${cog.rules.length ? `
              <div class="xeno-rule-list">
                ${cog.rules.map(r => `
                  <div class="xeno-rule-row ${r.enabled ? 'on' : 'off'}">
                    <button type="button" role="switch" aria-checked="${r.enabled}" class="xeno-switch-btn ${r.enabled ? 'on' : ''}" data-action="mod-toggle-rule" data-id="${esc(r.id)}"><i></i></button>
                    <span>${esc(r.text)}</span>
                    <button type="button" class="xeno-mini-btn danger" data-action="mod-del-rule" data-id="${esc(r.id)}">×</button>
                  </div>
                `).join('')}
              </div>
            ` : '<p class="xeno-hint">当前尚未植入常识改写词条。</p>'}
          </div>
        `}
      </div>
    `;
  }

  v.refresh = () => {
    const xeno = xenoState();
    const pView = effectiveEntityView(xeno, xeno.protagonist);
    const curTarget = xeno.targets.find(t => t.name === xeno.selectedTarget) || xeno.targets[0] || null;
    const tView = curTarget ? effectiveEntityView(xeno, curTarget) : null;

    v.draw(`
      ${heading(
        '异构终端',
        `<button type="button" class="round-button" data-action="open-wardrobe" title="打开衣柜">${icon('layers')}</button>
         <button type="button" class="round-button" data-action="open-mall" title="打开购物商城">${icon('shop')}</button>
         <button type="button" class="round-button ${settingsOpen ? 'active' : ''}" data-action="toggle-xeno-settings" title="终端设置">${icon('sliders')}</button>`,
        'Xeno Terminal'
      )}
      ${settingsOpen ? `
        <section class="xeno-settings-drawer">
          <div class="setting-row">
            <span>启用异构终端与状态栏注入${help('开启后自动替代原版 TavernDB，将主角与目标状态栏及当前激活的能力/衣柜设定注入酒馆提示词。')}</span>
            <button type="button" role="switch" aria-checked="${xeno.enabled}" class="xeno-switch-btn ${xeno.enabled ? 'on' : ''}" data-action="toggle-xeno-enabled"><i></i></button>
          </div>
          <div class="setting-row">
            <span>剧情回复自动同步状态栏${help('开启后，模型在剧情发生新角色登场或换装/状态变化时会自动附带隐藏同步块并在后台更新状态栏。')}</span>
            <button type="button" role="switch" aria-checked="${xeno.autoUpdateTag}" class="xeno-switch-btn ${xeno.autoUpdateTag ? 'on' : ''}" data-action="toggle-xeno-autosync"><i></i></button>
          </div>
          <label class="xeno-field-inline">
            <span>世界观载体自适应</span>
            <select class="xeno-select" data-change="change-carrier">
              ${WORLD_CARRIERS.map(([k, label]) => `<option value="${esc(k)}" ${xeno.worldCarrier === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
          </label>
        </section>
      ` : ''}
      ${xeno.pendingActionNote ? `
        <div class="xeno-pending-bar">
          <span>⚡ <b>待写入本轮剧情：</b>${esc(xeno.pendingActionNote)}</span>
          <button type="button" class="xeno-mini-btn" data-action="clear-pending">清除</button>
        </div>
      ` : ''}
      ${renderStatusBarCard({
        title: '主角状态栏',
        badge: 'PROTAGONIST',
        entity: xeno.protagonist,
        view: pView,
        isProt: true,
        detailOpen: showProtDetail
      })}
      ${renderStatusBarCard({
        title: '选定目标状态栏',
        badge: 'TARGET',
        entity: curTarget,
        view: tView,
        isProt: false,
        detailOpen: showTargetDetail,
        targetList: xeno.targets,
        selectedTarget: curTarget?.name || ''
      })}
      <nav class="xeno-module-tabs cols-5" aria-label="五大异构模块">
        <button type="button" class="xeno-tab ${activeTab === 'possession' ? 'active' : ''}" data-action="switch-tab" data-tab="possession">附身之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'fusion' ? 'active' : ''}" data-action="switch-tab" data-tab="fusion">融合之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'parasite' ? 'active' : ''}" data-action="switch-tab" data-tab="parasite">寄生之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'vore' ? 'active' : ''}" data-action="switch-tab" data-tab="vore">丸吞之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'mod' ? 'active' : ''}" data-action="switch-tab" data-tab="mod">改造</button>
      </nav>
      ${activeTab === 'possession' ? renderPossessionModule(xeno, curTarget) : ''}
      ${activeTab === 'fusion' ? renderFusionModule(xeno, curTarget) : ''}
      ${activeTab === 'parasite' ? renderParasiteModule() : ''}
      ${activeTab === 'vore' ? renderVoreModule(xeno, curTarget) : ''}
      ${activeTab === 'mod' ? renderModModule(xeno) : ''}
    `);
  };

  function openEntityEditSheet(entity, isProt) {
    const d = ctx.dialog(`编辑${isProt ? '主角' : '目标'}状态栏`, `
      <div class="xeno-sheet-form">
        <label class="xeno-field-inline"><span>姓名</span><input class="xeno-input" data-edit="name" value="${esc(entity.name)}"></label>
        <label class="xeno-field-inline"><span>身份</span><input class="xeno-input" data-edit="identity" value="${esc(entity.identity)}"></label>
        <label class="xeno-field-inline"><span>性别</span>
          <select class="xeno-select" data-edit="gender">
            ${GENDERS.map(g => `<option value="${esc(g)}" ${entity.gender === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          </select>
        </label>
        <label class="xeno-field-inline"><span>外貌特征</span><textarea class="xeno-textarea" rows="2" data-edit="appearance">${esc(entity.appearance)}</textarea></label>
        <label class="xeno-field-inline"><span>体型身材</span><textarea class="xeno-textarea" rows="2" data-edit="bodyBuild">${esc(entity.bodyBuild)}</textarea></label>
        <label class="xeno-field-inline"><span>生理特征</span><textarea class="xeno-textarea" rows="2" data-edit="physiology">${esc(entity.physiology)}</textarea></label>
        <label class="xeno-field-inline"><span>原始肉体</span><input class="xeno-input" data-edit="originalBody" value="${esc(entity.originalBody)}"></label>
        <label class="xeno-field-inline"><span>当前肉体</span><input class="xeno-input" data-edit="currentBody" value="${esc(entity.currentBody)}"></label>
        <div class="actions">
          <button type="button" class="secondary" data-sheet-cancel>取消</button>
          <button type="button" class="primary" data-sheet-save>保存修改</button>
        </div>
      </div>
    `);
    d.body.addEventListener('click', e => {
      if (e.target.closest('[data-sheet-cancel]')) d.close(null);
      if (e.target.closest('[data-sheet-save]')) {
        const read = k => d.body.querySelector(`[data-edit="${k}"]`)?.value?.trim() || '';
        api.xenoAct('applyBodyMod', {
          targetKey: isProt ? '__protagonist__' : entity.name,
          patch: {
            name: read('name') || entity.name,
            identity: read('identity'),
            gender: read('gender'),
            appearance: read('appearance'),
            bodyBuild: read('bodyBuild'),
            physiology: read('physiology'),
            originalBody: read('originalBody'),
            currentBody: read('currentBody')
          }
        });
        d.close(true);
        ctx.notify('状态栏已更新');
      }
    });
  }

  function openAddTargetSheet() {
    const d = ctx.dialog('新增目标角色', `
      <div class="xeno-sheet-form">
        <label class="xeno-field-inline"><span>姓名</span><input class="xeno-input" data-add="name" placeholder="例如：苏清雪"></label>
        <label class="xeno-field-inline"><span>身份</span><input class="xeno-input" data-add="identity" placeholder="例如：高冷学生会长 / 圣女"></label>
        <label class="xeno-field-inline"><span>性别</span>
          <select class="xeno-select" data-add="gender">
            ${GENDERS.map(g => `<option value="${esc(g)}" ${g === '女' ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          </select>
        </label>
        <label class="xeno-field-inline"><span>外貌特征</span><textarea class="xeno-textarea" rows="2" data-add="appearance" placeholder="发色、瞳色、五官气质…"></textarea></label>
        <label class="xeno-field-inline"><span>体型身材</span><textarea class="xeno-textarea" rows="2" data-add="bodyBuild" placeholder="身高、三围罩杯、腰臀腿曲线…"></textarea></label>
        <label class="xeno-field-inline"><span>生理特征</span><textarea class="xeno-textarea" rows="2" data-add="physiology" placeholder="正常女性生理构造 / 敏感带特征…"></textarea></label>
        <div class="actions">
          <button type="button" class="secondary" data-sheet-cancel>取消</button>
          <button type="button" class="primary" data-sheet-save>添加目标</button>
        </div>
      </div>
    `);
    d.body.addEventListener('click', e => {
      if (e.target.closest('[data-sheet-cancel]')) d.close(null);
      if (e.target.closest('[data-sheet-save]')) {
        const read = k => d.body.querySelector(`[data-add="${k}"]`)?.value?.trim() || '';
        const name = read('name');
        if (!name) { ctx.notify('请填写目标姓名', {error: true}); return; }
        api.xenoAct('addTarget', {
          name,
          identity: read('identity') || '登场角色',
          gender: read('gender') || '女',
          appearance: read('appearance') || '容貌出众',
          bodyBuild: read('bodyBuild') || '身材曼妙',
          physiology: read('physiology') || '正常女性生理构造'
        });
        d.close(true);
        ctx.notify(`已添加目标：${name}`);
      }
    });
  }

  v.on('click', '[data-action]', async el => {
    const act = el.dataset.action;
    const xeno = xenoState();
    const curTarget = xeno.targets.find(t => t.name === xeno.selectedTarget) || xeno.targets[0] || null;

    if (act === 'open-wardrobe') { ctx.open('wardrobe'); return; }
    if (act === 'open-mall') { ctx.open('mall'); return; }
    if (act === 'toggle-xeno-settings') { settingsOpen = !settingsOpen; v.refresh(); return; }
    if (act === 'toggle-xeno-enabled') { api.saveXeno({enabled: !xeno.enabled}); return; }
    if (act === 'toggle-xeno-autosync') { api.saveXeno({autoUpdateTag: !xeno.autoUpdateTag}); return; }
    if (act === 'clear-pending') { api.xenoAct('clearPendingNote'); return; }
    if (act === 'toggle-prot-detail') { showProtDetail = !showProtDetail; v.refresh(); return; }
    if (act === 'toggle-target-detail') { showTargetDetail = !showTargetDetail; v.refresh(); return; }
    if (act === 'edit-prot') { openEntityEditSheet(xeno.protagonist, true); return; }
    if (act === 'edit-target') { if (curTarget) openEntityEditSheet(curTarget, false); return; }
    if (act === 'add-target') { openAddTargetSheet(); return; }
    if (act === 'delete-target') {
      const name = el.dataset.name;
      if (name && await ctx.confirm(`删除目标「${name}」？`, '删除后将从目标状态栏下拉列表中移除。')) {
        api.xenoAct('deleteTarget', {name});
      }
      return;
    }
    if (act === 'sync-story') {
      await v.busy(el, () => api.xenoSyncStory());
      return;
    }
    if (act === 'switch-tab') { activeTab = el.dataset.tab; v.refresh(); return; }

    if (act === 'poss-way') {
      entryWay = el.dataset.way;
      if (entryWay === '近距锁定') chosenPossMode = '浅层共鸣';
      if (entryWay === '灵体游离') chosenPossMode = '完全占据';
      v.refresh();
      return;
    }
    if (act === 'poss-pick-mode') { chosenPossMode = el.dataset.mode; v.refresh(); return; }
    if (act === 'poss-insight') { await v.busy(el, () => api.xenoInsight()); return; }
    if (act === 'poss-from-report') {
      const name = el.dataset.name;
      api.xenoAct('startPossession', {targetName: name, mode: chosenPossMode, entryWay: '洞察推荐'});
      ctx.notify(`已对「${name}」发动附身（${chosenPossMode}）`);
      return;
    }
    if (act === 'poss-start') {
      if (!curTarget) return;
      api.xenoAct('startPossession', {targetName: curTarget.name, mode: chosenPossMode, entryWay});
      ctx.notify(`已对「${curTarget.name}」发动附身（${chosenPossMode}）`);
      return;
    }
    if (act === 'poss-switch-mode') {
      api.xenoAct('setPossessionMode', {mode: el.dataset.mode});
      ctx.notify(`附身状态已切换为：${el.dataset.mode}`);
      return;
    }
    if (act === 'poss-organ-sync') {
      api.xenoAct('toggleOrganSync');
      return;
    }
    if (act === 'poss-release') {
      const d = ctx.dialog('脱离附身 · 认知篡改结算', `
        <div class="xeno-sheet-form">
          <p class="help-copy">脱离瞬间将自动触发【认知篡改】，把附身期间的行为修饰为符合目标性格的虚假记忆，同时你的主魂将融合接收 30% 次魂在分离期间的记忆。</p>
          <label class="xeno-field-inline">
            <span>写入目标的虚假记忆（留空使用默认合理化）</span>
            <textarea class="xeno-textarea" rows="3" data-fake-mem placeholder="例如：只觉得刚才是一时兴起的自然举动，对主角充满亲近感，毫无违和感…"></textarea>
          </label>
          <div class="actions">
            <button type="button" class="secondary" data-sheet-cancel>取消</button>
            <button type="button" class="primary" data-sheet-confirm>确认脱离并回归本体</button>
          </div>
        </div>
      `);
      d.body.addEventListener('click', e => {
        if (e.target.closest('[data-sheet-cancel]')) d.close(null);
        if (e.target.closest('[data-sheet-confirm]')) {
          const fakeMemory = d.body.querySelector('[data-fake-mem]')?.value?.trim() || '';
          api.xenoAct('releasePossession', {fakeMemory});
          d.close(true);
          ctx.notify('已脱离附身并回归原始本体');
        }
      });
      return;
    }
    if (act === 'poss-swap') {
      const swapType = el.dataset.swap;
      if (await ctx.confirm('执行永久肉体互换？', '互换后，目标的肉体将永久成为你新的原始本体，目标灵魂将在你原先的肉体中苏醒。')) {
        api.xenoAct('bodySwap', {swapType});
        ctx.notify('已完成永久肉体互换！');
      }
      return;
    }
    if (act === 'poss-anchor-jump') {
      const name = el.dataset.name;
      api.xenoAct('startPossession', {targetName: name, mode: '完全占据', entryWay: '永久锚点远程切入'});
      ctx.notify(`已通过永久锚点远程切入「${name}」`);
      return;
    }
    if (act === 'poss-anchor-del') {
      api.xenoAct('deleteAnchor', {name: el.dataset.name});
      return;
    }

    if (act === 'fusion-pick-mode') { chosenFusionMode = el.dataset.mode; v.refresh(); return; }
    if (act === 'fusion-pick-branch') { chosenFusionBranch = el.dataset.branch; v.refresh(); return; }
    if (act === 'fusion-start') {
      if (!curTarget) return;
      api.xenoAct('startFusion', {targetName: curTarget.name, mode: chosenFusionMode, releaseBranch: chosenFusionBranch});
      ctx.notify(`已与「${curTarget.name}」发动肉体融合（${chosenFusionMode}）`);
      return;
    }
    if (act === 'fusion-switch-mode') {
      api.xenoAct('setFusionMode', {mode: el.dataset.mode});
      ctx.notify(`融合状态已切换为：${el.dataset.mode}`);
      return;
    }
    if (act === 'fusion-toggle-ctrl') {
      api.xenoAct('toggleFusionController');
      return;
    }
    if (act === 'fusion-release') {
      const branch = el.dataset.branch;
      api.xenoAct('releaseFusion', {branch});
      ctx.notify(`已解除融合（${branch}）${branch !== '正常分离' ? '，已存入衣柜' : ''}`);
      return;
    }

    if (act === 'vore-channel') { voreChannel = el.dataset.channel; v.refresh(); return; }
    if (act === 'vore-loc') { voreLocation = el.dataset.loc; v.refresh(); return; }
    if (act === 'vore-start') {
      const preyName = v.root.querySelector('#xeno-vore-prey')?.value?.trim() || curTarget?.name || '';
      if (!preyName) { ctx.notify('请填写或选择被吞噬的猎物名称', {error: true}); return; }
      api.xenoAct('startVore', {predatorKey: vorePredatorKey, preyName, channel: voreChannel, location: voreLocation});
      ctx.notify(`已将「${preyName}」吞入体内收纳`);
      return;
    }
    if (act === 'vore-release') {
      api.xenoAct('removeVore', {predatorKey: vorePredatorKey, entryId: el.dataset.id, mode: 'release'});
      ctx.notify('已将猎物排出体外');
      return;
    }
    if (act === 'vore-digest') {
      if (await ctx.confirm('彻底消化吸收？', '该猎物将被消化液彻底分解吸收转化为捕食者的养分。')) {
        api.xenoAct('removeVore', {predatorKey: vorePredatorKey, entryId: el.dataset.id, mode: 'digest'});
        ctx.notify('已彻底消化吸收');
      }
      return;
    }

    if (act === 'mod-subtab') { modSubTab = el.dataset.sub; v.refresh(); return; }
    if (act === 'mod-gender') {
      api.xenoAct('applyBodyMod', {targetKey: xeno.modTarget, patch: {gender: el.dataset.gender}});
      ctx.notify(`性别已改造为：${el.dataset.gender}`);
      return;
    }
    if (act === 'mod-tail') {
      api.xenoAct('applyBodyMod', {targetKey: xeno.modTarget, patch: {predatorTail: el.dataset.tail}});
      ctx.notify('丸吞尾状态已更新');
      return;
    }
    if (act === 'mod-save-body') {
      const appearance = v.root.querySelector('#xeno-mod-appearance')?.value?.trim() ?? '';
      const bodyBuild = v.root.querySelector('#xeno-mod-body')?.value?.trim() ?? '';
      const physiology = v.root.querySelector('#xeno-mod-phys')?.value?.trim() ?? '';
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.modTarget,
        patch: {appearance, bodyBuild, physiology}
      });
      ctx.notify('肉体改造已生效');
      return;
    }
    if (act === 'mod-save-cog') {
      const relationOverride = v.root.querySelector('#xeno-cog-relation')?.value?.trim() ?? '';
      const fakeMemory = v.root.querySelector('#xeno-cog-memory')?.value?.trim() ?? '';
      api.xenoAct('applyCognitionMod', {
        targetKey: xeno.modTarget,
        relationOverride,
        fakeMemory
      });
      ctx.notify('认知覆写与虚假记忆已保存');
      return;
    }
    if (act === 'mod-add-rule') {
      const text = v.root.querySelector('#xeno-cog-new-rule')?.value?.trim() || '';
      if (!text) { ctx.notify('请先输入常识改写词条内容', {error: true}); return; }
      api.xenoAct('applyCognitionMod', {targetKey: xeno.modTarget, addRule: text});
      ctx.notify('已添加常识改写词条');
      return;
    }
    if (act === 'mod-preset-rule') {
      api.xenoAct('applyCognitionMod', {targetKey: xeno.modTarget, addRule: el.dataset.rule});
      ctx.notify('已植入预设常识词条');
      return;
    }
    if (act === 'mod-del-rule') {
      api.xenoAct('applyCognitionMod', {targetKey: xeno.modTarget, removeRuleId: el.dataset.id});
      return;
    }
    if (act === 'mod-toggle-rule') {
      api.xenoAct('applyCognitionMod', {targetKey: xeno.modTarget, toggleRuleId: el.dataset.id});
      return;
    }
  });

  v.on('change', '[data-change]', el => {
    const act = el.dataset.change;
    const xeno = xenoState();
    if (act === 'change-carrier') { api.saveXeno({worldCarrier: el.value}); return; }
    if (act === 'select-target') { api.xenoAct('selectTarget', {name: el.value}); return; }
    if (act === 'vore-predator') { vorePredatorKey = el.value; v.refresh(); return; }
    if (act === 'vore-item-loc') {
      api.xenoAct('updateVore', {predatorKey: vorePredatorKey, entryId: el.dataset.id, patch: {location: el.value}});
      return;
    }
    if (act === 'vore-item-status') {
      api.xenoAct('updateVore', {predatorKey: vorePredatorKey, entryId: el.dataset.id, patch: {status: el.value}});
      return;
    }
    if (act === 'vore-item-digest') {
      api.xenoAct('updateVore', {predatorKey: vorePredatorKey, entryId: el.dataset.id, patch: {digestion: el.value}});
      return;
    }
    if (act === 'mod-select-target') { api.xenoAct('selectModTarget', {key: el.value}); return; }
    if (act === 'mod-orifice') {
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.modTarget,
        patch: {orificeMods: {[el.dataset.slot]: el.value}}
      });
      return;
    }
    if (act === 'mod-venom') {
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.modTarget,
        patch: {orificeMods: {venomType: el.value}}
      });
      return;
    }
  });

  v.refresh();
  return v;
}
