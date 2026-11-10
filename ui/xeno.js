// App 1: 异构终端 (xeno)
import {createView, esc, heading, help} from './common.js';
import {icon} from './icons.js';
import {
  GENDERS, POSSESSION_MODES, POSSESSION_WAYS, FUSION_MODES, FUSION_BRANCHES,
  PARASITE_KINDS, PARASITE_SITES, PARASITE_SITE_FORMS, PARASITE_MODES,
  PARASITE_HULK_FUTA_MODES, PARASITE_RELEASE_BRANCHES, parasiteSiteLabel,
  VORE_CHANNELS, VORE_LOCATIONS, VORE_STATUSES, VORE_DIGESTIONS,
  TAIL_STATES, ORIFICE_SLOTS, ORIFICE_MOD_TYPES, VENOM_TYPES, WORLD_CARRIERS,
  PRESET_COGNITION_RULES, effectiveEntityView, getEntity, computeFusionGender, formatVoiceRoleLabel
} from '../core/xeno.js';
import {renderVoiceBindSelectOptions, openVoicePoolPickerDialog, generateEntityPortrait, openEntityPortraitDialog} from './xeno-media.js';

export function xenoApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'xeno');
  let showProtDetail = false;
  let showTargetDetail = false;
  let activeTab = 'possession'; // 'possession' | 'fusion' | 'parasite' | 'vore' | 'body_mod' | 'cognition_mod'
  let entryWay = '近距锁定';
  let chosenPossMode = '浅层共鸣';
  let chosenFusionMode = '共存融合';
  let chosenFusionBranch = '正常分离';
  let chosenParaKind = 'scion';
  let chosenParaSite = 'crotch';
  let chosenParaForm = PARASITE_SITE_FORMS.crotch[1];
  let chosenParaMode = '潜伏共生';
  let chosenHulkFuta = '长在目标胯下';
  let chosenHulkLook = '';
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
    const targetKey = isProt ? '__protagonist__' : (entity?.name || '');
    return `
      <section class="xeno-status-card ${isProt ? 'prot' : 'target'}">
        <header class="xeno-status-head">
          <div class="xeno-status-title">
            <span class="xeno-badge ${isProt ? 'prot' : 'target'}">${esc(badge)}</span>
            <strong>${esc(title)}</strong>
          </div>
          <div class="xeno-status-actions">
            ${isProt ? `<button type="button" class="xeno-mini-btn" data-action="sync-story" ${api.xenoBusy?.('sync') ? 'disabled' : ''}>${api.xenoBusy?.('sync') ? '同步中…' : '从剧情同步'}</button>` : ''}
            ${isProt ? `<button type="button" class="xeno-mini-btn danger" data-action="reset-prot" title="新开聊天时清空主角状态栏与上一场的残留状态">初始化</button>` : ''}
            ${entity ? `<button type="button" class="xeno-mini-btn primary" data-action="draw-entity-portrait" data-target="${esc(targetKey)}" title="按当前肉体、穿戴与改造状态一键生成全身形态图">📸 形态图</button>` : ''}
            ${entity?.portraitData ? `<button type="button" class="xeno-mini-btn" data-action="view-entity-portrait" data-target="${esc(targetKey)}" title="查看已生成的形态立绘">🖼️ 看图</button>` : ''}
            <button type="button" class="xeno-mini-btn" data-action="${editAction}">编辑</button>
            <button type="button" class="xeno-mini-btn ${detailOpen ? 'active' : ''}" data-action="${toggleAction}">${detailOpen ? '收起详情' : '详情'}</button>
          </div>
        </header>
        ${!isProt ? `
          <div class="xeno-target-bar">
            <select class="xeno-select" data-change="select-target" aria-label="选择目标角色">
              ${targetList.length
                ? targetList.map(t => `<option value="${esc(t.name)}" ${t.name === selectedTarget ? 'selected' : ''}>🎯 目标：${esc(t.name)}${t.identity || t.gender ? `（${esc([t.identity, t.gender].filter(Boolean).join(' · '))}）` : ''}</option>`).join('')
                : '<option value="">（暂无普通角色目标，请从「角色」添加或从剧情同步）</option>'}
            </select>
            <div class="xeno-target-btns">
              <button type="button" class="xeno-mini-btn" data-action="open-roles">角色管理</button>
              <button type="button" class="xeno-mini-btn primary" data-action="add-target">+ 新增</button>
              ${entity ? `<button type="button" class="xeno-mini-btn danger" data-action="delete-target" data-name="${esc(entity.name)}">删除</button>` : ''}
            </div>
          </div>
        ` : ''}
        ${entity ? `
          <div class="xeno-vertical-list">
            <div class="xeno-kv"><span class="k">姓名</span><span class="v"><b>${esc(view.name)}</b></span></div>
            <div class="xeno-kv"><span class="k">身份</span><span class="v">${esc(view.identity)}</span></div>
            <div class="xeno-kv"><span class="k">性别</span><span class="v">${view.gender ? `<i class="xeno-gender-tag" data-gender="${esc(view.gender)}">${esc(view.gender)}</i>` : ''}</span></div>
            <div class="xeno-kv"><span class="k">外貌特征</span><span class="v">${esc(view.appearance)}</span></div>
            <div class="xeno-kv"><span class="k">体型身材</span><span class="v">${esc(view.bodyBuild)}</span></div>
            <div class="xeno-kv"><span class="k">生理特征</span><span class="v">${esc(view.physiology)}</span></div>
            <div class="xeno-kv"><span class="k">头部</span><span class="v">${esc(view.headAppearance || '未记录')}<br><small>来源：${esc(view.headSource)} ｜ ${esc(view.voiceStateText)}</small></span></div>
            <div class="xeno-kv"><span class="k">下体外观</span><span class="v">${esc(view.organAppearance || '本体未记录')}<br><small>来源：${esc(view.organSource)}</small></span></div>
            ${view.equipmentAbilities ? `<div class="xeno-kv"><span class="k">装备能力及条件</span><span class="v">${esc(view.equipmentAbilities).replace(/\n/g, '<br>')}</span></div>` : ''}
          </div>
          ${detailOpen ? `
            <div class="xeno-detail-list">
              <div class="xeno-detail-divider"><span>深层映射与挂载详情（9项）</span></div>
              <div class="xeno-kv detail"><span class="k">原始肉体</span><span class="v">${esc(view.originalBody)}</span></div>
              <div class="xeno-kv detail"><span class="k">当前肉体</span><span class="v">${esc(view.currentBody)}</span></div>
              <div class="xeno-kv detail"><span class="k">变更原因</span><span class="v">${esc(view.changeReason)}</span></div>
              <div class="xeno-kv detail"><span class="k">托管状态</span><span class="v">${esc(view.hostingState)}</span></div>
              <div class="xeno-kv detail"><span class="k">声带音色</span><span class="v">${esc(view.voiceStateText)}</span></div>
              <div class="xeno-kv detail"><span class="k">皮躯/肉躯挂载</span><span class="v">${esc(view.livingMountText)}</span></div>
              <div class="xeno-kv detail"><span class="k">四槽位着装</span><span class="v">${esc(view.outfitText)}</span></div>
              <div class="xeno-kv detail"><span class="k">体内收纳</span><span class="v">${esc(view.voreText)}</span></div>
              <div class="xeno-kv detail"><span class="k">认知状态</span><span class="v">${esc(view.cognitionText)}</span></div>
            </div>
          ` : ''}
        ` : `<p class="xeno-empty-note">目标列表自动读取「角色」应用中标记为【普通角色】的角色（【主角】绑定主角状态栏，【旁白角色】自动排除）。可点击「角色管理」调整分类，或点击「+ 新增」/「从剧情同步」。</p>`}
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

  function renderParasiteModule(xeno, curTarget) {
    const para = xeno.parasite || {active: false, bodyHost: null, scions: []};
    const bh = para.bodyHost;
    const scions = para.scions || [];
    const modeDescriptions = {
      '潜伏共生': '宿主未察觉独立寄生意识的存在，将新长出的器官、后庭异感或巨躯共生合理化为自身奇异变异',
      '共生同化': '宿主在共生激素与快感浸染下，认知上将寄生体（或相连巨躯）视为天生不可分割的身体延伸，产生强烈生理与心理依赖',
      '合作共生': '宿主清楚知晓主角/子体的存在，双方意识互通并达成共生默契，可在脑内私密交流，在日常、战斗与欢愉中主动配合'
    };
    const activeForms = PARASITE_SITE_FORMS[chosenParaSite] || PARASITE_SITE_FORMS.crotch;
    if (!activeForms.includes(chosenParaForm)) chosenParaForm = activeForms[0];

    const statusSummary = [
      bh?.targetName ? `本体化形：${bh.targetName}` : '',
      scions.length ? `分体子体：${scions.length}人` : ''
    ].filter(Boolean).join(' · ') || '未发动';

    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>寄生之术</strong>
          <span class="xeno-state-pill ${para.active ? 'on' : ''}">${esc(statusSummary)}</span>
        </div>

        ${bh ? `
          <div class="xeno-active-banner" style="margin-bottom:10px">
            <p><b>🧬 本体化形寄生中：</b>宿主【${esc(bh.targetName)}】 ｜ <b>部位：</b>${esc(parasiteSiteLabel(bh.site))}</p>
            <p class="sub">主角原始本体已浓缩化形为宿主的共生器官，保有100%自主意识并与宿主全感官共享。</p>
            <div class="xeno-label">切换化形部位</div>
            <div class="xeno-chip-group">
              ${PARASITE_SITES.filter(([k]) => k !== 'back_hulk').map(([k, label]) => `
                <button type="button" class="xeno-chip ${bh.site === k ? 'active' : ''}" data-action="para-update" data-kind="body" data-target="${esc(bh.targetName)}" data-field="site" data-val="${esc(k)}">${esc(label.split('（')[0])}</button>
              `).join('')}
            </div>
            <div class="xeno-label">切换当前部位形态</div>
            <div class="xeno-chip-group">
              ${(PARASITE_SITE_FORMS[bh.site] || []).map(f => `
                <button type="button" class="xeno-chip ${bh.form === f ? 'active' : ''}" data-action="para-update" data-kind="body" data-target="${esc(bh.targetName)}" data-field="form" data-val="${esc(f)}">${esc(f.split('（')[0])}</button>
              `).join('')}
            </div>
            <div class="xeno-label">切换宿主共生状态</div>
            <div class="xeno-chip-group">
              ${PARASITE_MODES.map(m => `
                <button type="button" class="xeno-chip ${bh.mode === m ? 'active' : ''}" data-action="para-update" data-kind="body" data-target="${esc(bh.targetName)}" data-field="mode" data-val="${esc(m)}">${esc(m)}</button>
              `).join('')}
            </div>
            <div class="xeno-swap-box">
              <span>⚡ <b>脱离与演化分支（可选）：</b></span>
              <div class="xeno-row-controls" style="flex-wrap:wrap;gap:6px">
                ${PARASITE_RELEASE_BRANCHES.map(b => `
                  <button type="button" class="xeno-mini-btn ${b === '永久器官固化' ? 'primary' : b.includes('衣柜') ? 'warn' : ''}" data-action="para-release" data-kind="body" data-target="${esc(bh.targetName)}" data-branch="${esc(b)}">${esc(b)}</button>
                `).join('')}
              </div>
            </div>
          </div>
        ` : ''}

        ${scions.length ? `
          <div class="xeno-sub-box" style="margin-bottom:10px">
            <div class="xeno-label">🦠 在宿【分体子体寄生】列表（主角本体在外界自由行动 + 远程最高控制权）</div>
            ${scions.map(sc => {
              const isHulk = sc.site === 'back_hulk';
              const hulkActive = isHulk && sc.form.startsWith('激活态');
              return `
                <div class="xeno-report-card" style="margin-top:8px">
                  <div class="xeno-report-head">
                    <strong>🎯 宿主：${esc(sc.targetName)}</strong>
                    <small>${esc(parasiteSiteLabel(sc.site).split('（')[0])}</small>
                    <span class="xeno-score">${esc(sc.mode)}</span>
                  </div>
                  <div class="xeno-label" style="margin-top:6px">子体寄生部位</div>
                  <div class="xeno-chip-group">
                    ${PARASITE_SITES.map(([k, label]) => `
                      <button type="button" class="xeno-chip ${sc.site === k ? 'active' : ''}" data-action="para-update" data-kind="scion" data-target="${esc(sc.targetName)}" data-field="site" data-val="${esc(k)}">${esc(label.split('（')[0])}</button>
                    `).join('')}
                  </div>
                  ${isHulk ? `
                    <div class="xeno-label" style="margin-top:6px">背面巨躯状态（屁穴潜伏子体细胞 ⇄ 背面无头巨躯展开）</div>
                    <div class="xeno-row-controls" style="margin-bottom:6px">
                      ${PARASITE_SITE_FORMS.back_hulk.map(f => {
                        const on = sc.form === f;
                        const isAct = f.startsWith('激活态');
                        return `<button type="button" class="xeno-btn ${on ? (isAct ? 'accent' : 'primary') : 'secondary'}" data-action="para-update" data-kind="scion" data-target="${esc(sc.targetName)}" data-field="form" data-val="${esc(f)}">
                          ${isAct ? '🔥 激活背面无头巨躯（从屁穴分裂膨胀镶嵌）' : '🟢 关闭并缩回屁穴（潜伏子体细胞）'}
                        </button>`;
                      }).join('')}
                    </div>
                    <div class="xeno-label">扶她肉棒位置区分（目标胯下 vs 巨躯胯下）</div>
                    <div class="xeno-chip-group">
                      ${PARASITE_HULK_FUTA_MODES.map(fm => `
                        <button type="button" class="xeno-chip ${sc.hulkFutaMode === fm ? 'active' : ''}" data-action="para-update" data-kind="scion" data-target="${esc(sc.targetName)}" data-field="hulkFutaMode" data-val="${esc(fm)}">${esc(fm)}</button>
                      `).join('')}
                    </div>
                    <label class="xeno-field-inline" style="margin-top:6px">
                      <span>巨躯外观设定（留空则默认衍生自【${esc(sc.targetName)}】自身特征，或由主角自定义）</span>
                      <div style="display:flex;gap:6px">
                        <input type="text" class="xeno-input" data-hulk-look-for="${esc(sc.targetName)}" value="${esc(sc.hulkAppearance || '')}" placeholder="留空默认随目标自身特征，或填如：肌肉虬结的古铜色无头巨躯">
                        <button type="button" class="xeno-mini-btn primary" data-action="para-save-hulk-look" data-target="${esc(sc.targetName)}">保存外观</button>
                      </div>
                    </label>
                    <p class="xeno-hint" style="margin-top:4px">
                      ${hulkActive
                        ? `当前巨躯已从屁穴分裂展开，将【${esc(sc.targetName)}】四肢没入正面镶嵌于胸腹中央。相连后她控制活体巨躯就像控制自己原本身体一样浑然一体，但主角的控制权更高，随时可凭意念压制或接管。`
                        : `当前巨躯已收缩回【${esc(sc.targetName)}】的屁穴（后庭直肠）深处化作潜伏子体细胞，外表与常人无异，点击上方激活即可瞬间破体膨胀展开。`}
                    </p>
                  ` : `
                    <div class="xeno-label" style="margin-top:6px">当前部位形态</div>
                    <div class="xeno-chip-group">
                      ${(PARASITE_SITE_FORMS[sc.site] || []).map(f => `
                        <button type="button" class="xeno-chip ${sc.form === f ? 'active' : ''}" data-action="para-update" data-kind="scion" data-target="${esc(sc.targetName)}" data-field="form" data-val="${esc(f)}">${esc(f)}</button>
                      `).join('')}
                    </div>
                  `}
                  <div class="xeno-label" style="margin-top:6px">宿主共生状态</div>
                  <div class="xeno-chip-group">
                    ${PARASITE_MODES.map(m => `
                      <button type="button" class="xeno-chip ${sc.mode === m ? 'active' : ''}" data-action="para-update" data-kind="scion" data-target="${esc(sc.targetName)}" data-field="mode" data-val="${esc(m)}">${esc(m)}</button>
                    `).join('')}
                  </div>
                  <div class="xeno-swap-box" style="margin-top:8px">
                    <span>⚡ <b>脱离与演化分支（可选）：</b></span>
                    <div class="xeno-row-controls" style="flex-wrap:wrap;gap:6px">
                      ${PARASITE_RELEASE_BRANCHES.map(b => `
                        <button type="button" class="xeno-mini-btn ${b === '永久器官固化' ? 'primary' : b.includes('衣柜') ? 'warn' : ''}" data-action="para-release" data-kind="scion" data-target="${esc(sc.targetName)}" data-branch="${esc(b)}">${esc(b)}</button>
                      `).join('')}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        <div class="xeno-form-block">
          <div class="xeno-label">1. 选择寄生模式（支持本体化形 & 分体子体双模式）</div>
          <div class="xeno-chip-group">
            ${PARASITE_KINDS.map(([k, label]) => `
              <button type="button" class="xeno-chip ${chosenParaKind === k ? 'active' : ''}" data-action="para-pick-kind" data-kind="${esc(k)}">${esc(label)}</button>
            `).join('')}
          </div>

          <div class="xeno-label">2. 选择寄生部位</div>
          <div class="xeno-chip-group">
            ${PARASITE_SITES.map(([k, label]) => `
              <button type="button" class="xeno-chip ${chosenParaSite === k ? 'active' : ''}" data-action="para-pick-site" data-site="${esc(k)}">${esc(label)}</button>
            `).join('')}
          </div>

          <div class="xeno-label">3. 选择初始形态</div>
          <div class="xeno-chip-group">
            ${activeForms.map(f => `
              <button type="button" class="xeno-chip ${chosenParaForm === f ? 'active' : ''}" data-action="para-pick-form" data-form="${esc(f)}">${esc(f)}</button>
            `).join('')}
          </div>

          ${chosenParaSite === 'back_hulk' ? `
            <div class="xeno-sub-box" style="margin:6px 0">
              <div class="xeno-label">背面无头巨躯 · 扶她肉棒位置区分</div>
              <div class="xeno-chip-group">
                ${PARASITE_HULK_FUTA_MODES.map(fm => `
                  <button type="button" class="xeno-chip ${chosenHulkFuta === fm ? 'active' : ''}" data-action="para-pick-hulk-futa" data-futa="${esc(fm)}">${esc(fm)}</button>
                `).join('')}
              </div>
              <label class="xeno-field-inline" style="margin-top:6px">
                <span>巨躯外观设定（留空则默认衍生自目标自身特征，或由主角自定义）</span>
                <input type="text" class="xeno-input" id="xeno-para-hulk-look" value="${esc(chosenHulkLook)}" placeholder="例如：肌肉虬结庞大的古铜色无头躯干（留空则默认跟随目标自身特征）">
              </label>
              <p class="xeno-hint" style="margin-top:4px">
                关闭状态下为寄生在目标屁穴内的子体细胞；激活时从屁穴快速分裂膨胀为背面无头巨躯，将目标正面四肢没入镶嵌。相连后目标控制巨躯就像控制自己身体一样自然，但主角拥有更高控制权。
              </p>
            </div>
          ` : ''}

          <div class="xeno-label">4. 选择宿主共生状态</div>
          <div class="xeno-chip-group">
            ${PARASITE_MODES.map(m => `
              <button type="button" class="xeno-chip ${chosenParaMode === m ? 'active' : ''}" data-action="para-pick-mode" data-mode="${esc(m)}">${esc(m)}</button>
            `).join('')}
          </div>
          <p class="xeno-hint">${esc(modeDescriptions[chosenParaMode] || '')}</p>

          <div class="xeno-row-controls">
            <button type="button" class="xeno-btn primary full" data-action="para-start" ${!curTarget ? 'disabled' : ''}>
              ${curTarget
                ? `🧬 对【${esc(curTarget.name)}】发动${chosenParaKind === 'body' ? '本体化形寄生' : '分体子体寄生'}（${esc(parasiteSiteLabel(chosenParaSite).split('（')[0])} · ${esc(chosenParaMode)}）`
                : '请先在顶部目标状态栏选择或新增目标'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderVoreModule(xeno, curTarget) {
    const allPeople = [
      ['__protagonist__', `主角${xeno.protagonist.name ? '：' + xeno.protagonist.name : ''}`],
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

  function renderBodyModModule(xeno) {
    const protBodyName = xeno.protagonist.currentBody || xeno.protagonist.originalBody || (xeno.protagonist.name ? `${xeno.protagonist.name}的肉体` : '主角当前肉体');
    const bodyChoices = [
      ['__protagonist__', `🧬 主角肉体：${protBodyName}`],
      ...xeno.targets.map(t => {
        const bName = t.currentBody || t.originalBody || `${t.name}的肉体`;
        return [t.name, `🧬 角色肉体：${bName}（${t.name}）`];
      })
    ];
    const targetKey = xeno.bodyModTarget || '__protagonist__';
    const entity = getEntity(xeno, targetKey) || xeno.protagonist;
    const curBodyLabel = entity.currentBody || entity.originalBody || (entity.name ? `${entity.name}的肉体` : '主角肉体');
    const state = api.getState();
    const routes = (state.routes || []).filter(r => r?.name && r.roleKind !== 'narrator');
    const voicePool = state.voicePool || [];
    const view = effectiveEntityView(xeno, entity);
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>🧬 肉体改造（改造角色的物理躯体）</strong>
          <select class="xeno-select compact" data-change="select-body-mod-target" aria-label="选择要改造的肉体">
            ${bodyChoices.map(([k, label]) => `<option value="${esc(k)}" ${targetKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
        <p class="xeno-hint">当前改造躯体：<b>${esc(curBodyLabel)}</b>（直接改造该具肉体的性别、外貌、三围、生理构造与丸吞尾/孔洞异化）</p>
        <div class="xeno-form-block">
          <div class="xeno-label">肉体基础性别改造</div>
          <div class="xeno-chip-group">
            ${GENDERS.map(g => `<button type="button" class="xeno-chip ${entity.gender === g ? 'active' : ''}" data-action="mod-gender" data-gender="${esc(g)}">${esc(g)}</button>`).join('')}
          </div>
          <div class="xeno-label">🎙️ 肉体声带与音色绑定（可从「音色收藏夹」或「角色」App 选择）</div>
          <div class="xeno-row-controls">
            <select class="xeno-select" id="xeno-mod-voice-role" data-change="mod-voice-role" aria-label="绑定声带音色角色" style="flex:1">
              ${renderVoiceBindSelectOptions({
                currentValue: entity.voiceRole || '',
                emptyLabel: `默认（跟随本人原名音色${entity.name ? `：${entity.name}` : ''}）`,
                routes,
                voicePool
              })}
            </select>
            <button type="button" class="xeno-mini-btn primary" data-action="mod-pick-fav-voice">♡ 从收藏夹选</button>
            <button type="button" class="xeno-mini-btn" data-action="open-roles">去角色 App</button>
          </div>
          <p class="xeno-hint">当前发声状态：<b>${esc(view.voiceStateText)}</b></p>
          <label class="xeno-field-inline">
            <span>肉体外貌特征改造</span>
            <textarea class="xeno-textarea" id="xeno-mod-appearance" rows="2" placeholder="改造该肉体的发色、瞳色、五官气质…">${esc(entity.appearance)}</textarea>
          </label>
          <label class="xeno-field-inline">
            <span>肉体体型身材改造（胸围/腰臀/身高）</span>
            <textarea class="xeno-textarea" id="xeno-mod-body" rows="2" placeholder="改造该肉体的身高、三围罩杯、腰臀腿曲线…">${esc(entity.bodyBuild)}</textarea>
          </label>
          <label class="xeno-field-inline">
            <span>肉体生理特征改造（器官尺寸/敏感度/体质）</span>
            <textarea class="xeno-textarea" id="xeno-mod-phys" rows="2" placeholder="改造该肉体的生殖器官构造、敏感度、特殊体质…">${esc(entity.physiology)}</textarea>
          </label>
          <div class="xeno-label">🦎 丸吞尾（异化捕食尾 · 挂载于该肉体尾椎）</div>
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
            <button type="button" class="xeno-btn primary full" data-action="mod-save-body">💾 保存并应用对【${esc(curBodyLabel)}】的肉体改造</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderCognitionModModule(xeno) {
    const personChoices = [
      ...xeno.targets.map(t => [t.name, `🧠 角色本身：${t.name}${t.identity ? `（${t.identity}）` : ''}`]),
      ['__protagonist__', `🧠 主角本身${xeno.protagonist.name ? `：${xeno.protagonist.name}` : ''}`]
    ];
    const targetKey = (xeno.cogModTarget && personChoices.some(([k]) => k === xeno.cogModTarget))
      ? xeno.cogModTarget
      : (xeno.selectedTarget || personChoices[0]?.[0] || '__protagonist__');
    const entity = getEntity(xeno, targetKey) || xeno.targets[0] || xeno.protagonist;
    const cog = entity.cognitionState;
    const personName = entity.name || '当前角色';
    return `
      <div class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>🧠 认知修改（修改角色本身的灵魂与潜意识）</strong>
          <select class="xeno-select compact" data-change="select-cog-mod-target" aria-label="选择要修改认知的角色本身">
            ${personChoices.map(([k, label]) => `<option value="${esc(k)}" ${targetKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
        <p class="xeno-hint">当前修改对象：<b>【${esc(personName)}】角色本身</b>（直接作用于该角色的自我意识、对主角关系认知、常识法则与虚假记忆，不受肉体变更影响）</p>
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
            <button type="button" class="xeno-btn primary full" data-action="mod-save-cog" data-target="${esc(targetKey)}">💾 保存对【${esc(personName)}】的关系认知与虚假记忆</button>
          </div>
          <div class="xeno-label">📜 常识改写词条（潜意识法则覆写）</div>
          <div class="xeno-row-controls">
            <input type="text" class="xeno-input" id="xeno-cog-new-rule" placeholder="输入一条针对该角色本身的常识改写规则…">
            <button type="button" class="xeno-btn secondary" data-action="mod-add-rule" data-target="${esc(targetKey)}">+ 添加词条</button>
          </div>
          <div class="xeno-preset-rules">
            <small>快捷植入预设常识：</small>
            ${PRESET_COGNITION_RULES.map(r => `<button type="button" class="xeno-mini-btn" data-action="mod-preset-rule" data-target="${esc(targetKey)}" data-rule="${esc(r)}">+ ${esc(r.slice(0, 18))}…</button>`).join('')}
          </div>
          ${cog.rules.length ? `
            <div class="xeno-rule-list">
              ${cog.rules.map(r => `
                <div class="xeno-rule-row ${r.enabled ? 'on' : 'off'}">
                  <button type="button" role="switch" aria-checked="${r.enabled}" class="xeno-switch-btn ${r.enabled ? 'on' : ''}" data-action="mod-toggle-rule" data-target="${esc(targetKey)}" data-id="${esc(r.id)}"><i></i></button>
                  <span>${esc(r.text)}</span>
                  <button type="button" class="xeno-mini-btn danger" data-action="mod-del-rule" data-target="${esc(targetKey)}" data-id="${esc(r.id)}">×</button>
                </div>
              `).join('')}
            </div>
          ` : '<p class="xeno-hint">当前尚未对该角色植入常识改写词条。</p>'}
        </div>
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
          <div class="setting-row">
            <span>正文自动穿脱与购买确认${help('复用正文模型识别已完成的穿脱，无额外模型请求。衣柜物品直接同步；商店物品先询问名称与价格，确认后才扣费穿戴。')}</span>
            <button type="button" role="switch" aria-checked="${xeno.autoWardrobe}" class="xeno-switch-btn ${xeno.autoWardrobe ? 'on' : ''}" data-action="toggle-auto-wardrobe"><i></i></button>
          </div>
          <div class="xeno-row-controls" style="margin-top:6px">
            <button type="button" class="xeno-btn secondary full" data-action="open-xeno-presets">📝 手动修改异构提示词（前往「预设 · 异构」）</button>
          </div>
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
      <nav class="xeno-module-tabs cols-3" aria-label="六大异构模块">
        <button type="button" class="xeno-tab ${activeTab === 'possession' ? 'active' : ''}" data-action="switch-tab" data-tab="possession">附身之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'fusion' ? 'active' : ''}" data-action="switch-tab" data-tab="fusion">融合之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'parasite' ? 'active' : ''}" data-action="switch-tab" data-tab="parasite">寄生之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'vore' ? 'active' : ''}" data-action="switch-tab" data-tab="vore">丸吞之术</button>
        <button type="button" class="xeno-tab ${activeTab === 'body_mod' ? 'active' : ''}" data-action="switch-tab" data-tab="body_mod">肉体改造</button>
        <button type="button" class="xeno-tab ${activeTab === 'cognition_mod' ? 'active' : ''}" data-action="switch-tab" data-tab="cognition_mod">认知修改</button>
      </nav>
      ${activeTab === 'possession' ? renderPossessionModule(xeno, curTarget) : ''}
      ${activeTab === 'fusion' ? renderFusionModule(xeno, curTarget) : ''}
      ${activeTab === 'parasite' ? renderParasiteModule(xeno, curTarget) : ''}
      ${activeTab === 'vore' ? renderVoreModule(xeno, curTarget) : ''}
      ${activeTab === 'body_mod' ? renderBodyModModule(xeno) : ''}
      ${activeTab === 'cognition_mod' ? renderCognitionModModule(xeno) : ''}
    `);
  };

  function openEntityEditSheet(entity, isProt) {
    const state = api.getState();
    const routes = (state.routes || []).filter(r => r?.name && r.roleKind !== 'narrator');
    const voicePool = state.voicePool || [];
    const d = ctx.dialog(`编辑${isProt ? '主角' : '目标'}状态栏`, `
      <div class="xeno-sheet-form">
        <label class="xeno-field-inline"><span>姓名</span><input class="xeno-input" data-edit="name" value="${esc(entity.name)}"></label>
        <label class="xeno-field-inline"><span>身份</span><input class="xeno-input" data-edit="identity" value="${esc(entity.identity)}"></label>
        <label class="xeno-field-inline"><span>性别</span>
          <select class="xeno-select" data-edit="gender">
            <option value="" ${!entity.gender ? 'selected' : ''}>（留空）</option>
            ${GENDERS.map(g => `<option value="${esc(g)}" ${entity.gender === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          </select>
        </label>
        <label class="xeno-field-inline"><span>外貌特征</span><textarea class="xeno-textarea" rows="2" data-edit="appearance">${esc(entity.appearance)}</textarea></label>
        <label class="xeno-field-inline"><span>体型身材</span><textarea class="xeno-textarea" rows="2" data-edit="bodyBuild">${esc(entity.bodyBuild)}</textarea></label>
        <label class="xeno-field-inline"><span>生理特征</span><textarea class="xeno-textarea" rows="2" data-edit="physiology">${esc(entity.physiology)}</textarea></label>
        <label class="xeno-field-inline"><span>原始肉体</span><input class="xeno-input" data-edit="originalBody" value="${esc(entity.originalBody)}"></label>
        <label class="xeno-field-inline"><span>当前肉体</span><input class="xeno-input" data-edit="currentBody" value="${esc(entity.currentBody)}"></label>
        <div class="xeno-field-inline">
          <div class="xeno-row-between" style="margin-bottom:4px">
            <span>当前肉体绑定声带音色</span>
            <button type="button" class="xeno-mini-btn primary" data-sheet-pick-fav>♡ 从音色收藏夹选</button>
          </div>
          <select class="xeno-select" data-edit="voiceRole">
            ${renderVoiceBindSelectOptions({currentValue: entity.voiceRole || '', emptyLabel: '默认（跟随本人角色名）', routes, voicePool})}
          </select>
        </div>
        <div class="actions">
          <button type="button" class="secondary" data-sheet-cancel>取消</button>
          <button type="button" class="primary" data-sheet-save>保存修改</button>
        </div>
      </div>
    `);
    d.body.addEventListener('click', e => {
      if (e.target.closest('[data-sheet-cancel]')) d.close(null);
      if (e.target.closest('[data-sheet-pick-fav]')) {
        const sel = d.body.querySelector('[data-edit="voiceRole"]');
        openVoicePoolPickerDialog(ctx, {
          currentValue: sel?.value || '',
          onSelect: (ref, label) => {
            api.xenoAct('applyBodyMod', {
              targetKey: isProt ? '__protagonist__' : entity.name,
              patch: {voiceRole: ref}
            });
            if (sel) {
              const latest = api.getState();
              sel.innerHTML = renderVoiceBindSelectOptions({
                currentValue: ref,
                emptyLabel: '默认（跟随本人角色名）',
                routes: latest.routes || [],
                voicePool: latest.voicePool || []
              });
              sel.value = ref;
            }
            ctx.notify(ref ? `已绑定${label}` : '已恢复默认本人音色');
          }
        });
        return;
      }
      if (e.target.closest('[data-sheet-save]')) {
        const read = k => d.body.querySelector(`[data-edit="${k}"]`)?.value?.trim() || '';
        api.xenoAct('applyBodyMod', {
          targetKey: isProt ? '__protagonist__' : entity.name,
          patch: {
            name: read('name'),
            identity: read('identity'),
            gender: read('gender'),
            appearance: read('appearance'),
            bodyBuild: read('bodyBuild'),
            physiology: read('physiology'),
            originalBody: read('originalBody'),
            currentBody: read('currentBody'),
            voiceRole: read('voiceRole')
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
    if (act === 'open-roles') { ctx.open('roles'); return; }
    if (act === 'open-xeno-presets') { ctx.open('presets'); ctx.showPresetKind?.('xeno'); return; }
    if (act === 'toggle-xeno-settings') { settingsOpen = !settingsOpen; v.refresh(); return; }
    if (act === 'toggle-xeno-enabled') { api.saveXeno({enabled: !xeno.enabled}); return; }
    if (act === 'toggle-xeno-autosync') { api.saveXeno({autoUpdateTag: !xeno.autoUpdateTag}); return; }
    if (act === 'toggle-auto-wardrobe') { api.saveXeno({autoWardrobe: !xeno.autoWardrobe}); return; }
    if (act === 'clear-pending') { api.xenoAct('clearPendingNote'); return; }
    if (act === 'toggle-prot-detail') { showProtDetail = !showProtDetail; v.refresh(); return; }
    if (act === 'toggle-target-detail') { showTargetDetail = !showTargetDetail; v.refresh(); return; }
    if (act === 'reset-prot') {
      const d = ctx.dialog('初始化主角状态栏（新开聊天清空）', `
        <div class="xeno-sheet-form">
          <p class="help-copy">将清空主角状态栏中的姓名、身份、性别、外貌、身材、生理特征及所有深层详情（原始/当前肉体、穿戴挂载、体内收纳、认知状态），并解除上一场聊天残留的附身与融合状态。</p>
          <label style="display:flex;align-items:center;gap:6px;margin:8px 0;font-size:12px;cursor:pointer">
            <input type="checkbox" data-reset-targets>
            <span>同时初始化清空所有目标角色的状态栏改造记录与附身锚点</span>
          </label>
          <div class="actions">
            <button type="button" class="secondary" data-sheet-cancel>取消</button>
            <button type="button" class="danger" data-sheet-confirm>确认初始化清空</button>
          </div>
        </div>
      `);
      d.body.addEventListener('click', e => {
        if (e.target.closest('[data-sheet-cancel]')) d.close(null);
        if (e.target.closest('[data-sheet-confirm]')) {
          const resetTargets = !!d.body.querySelector('[data-reset-targets]')?.checked;
          api.xenoAct('resetProtagonist', {resetTargets});
          d.close(true);
          ctx.notify(resetTargets ? '主角与目标状态栏均已初始化清空' : '主角状态栏已初始化清空');
        }
      });
      return;
    }
    if (act === 'edit-prot') { openEntityEditSheet(xeno.protagonist, true); return; }
    if (act === 'edit-target') { if (curTarget) openEntityEditSheet(curTarget, false); return; }
    if (act === 'view-entity-portrait') {
      openEntityPortraitDialog(ctx, el.dataset.target || '__protagonist__');
      return;
    }
    if (act === 'draw-entity-portrait') {
      const tKey = el.dataset.target || '__protagonist__';
      if (!api.drawReady?.()) {
        openEntityPortraitDialog(ctx, tKey);
        return;
      }
      await v.busy(el, async () => {
        const url = await generateEntityPortrait(ctx, tKey);
        if (url) openEntityPortraitDialog(ctx, tKey);
      });
      return;
    }
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

    if (act === 'para-pick-kind') {
      chosenParaKind = el.dataset.kind === 'body' ? 'body' : 'scion';
      if (chosenParaKind === 'body' && chosenParaSite === 'back_hulk') {
        chosenParaSite = 'crotch';
        chosenParaForm = PARASITE_SITE_FORMS.crotch[1];
      }
      v.refresh();
      return;
    }
    if (act === 'para-pick-site') {
      chosenParaSite = el.dataset.site || 'crotch';
      if (chosenParaSite === 'back_hulk') chosenParaKind = 'scion';
      const forms = PARASITE_SITE_FORMS[chosenParaSite] || PARASITE_SITE_FORMS.crotch;
      chosenParaForm = forms[chosenParaSite === 'crotch' || chosenParaSite === 'back_hulk' ? 1 : 0] || forms[0];
      v.refresh();
      return;
    }
    if (act === 'para-pick-form') {
      chosenParaForm = el.dataset.form || '';
      v.refresh();
      return;
    }
    if (act === 'para-pick-mode') {
      chosenParaMode = el.dataset.mode || '潜伏共生';
      v.refresh();
      return;
    }
    if (act === 'para-pick-hulk-futa') {
      chosenHulkLook = v.root.querySelector('#xeno-para-hulk-look')?.value || chosenHulkLook;
      chosenHulkFuta = el.dataset.futa || '长在目标胯下';
      v.refresh();
      return;
    }
    if (act === 'para-start') {
      if (!curTarget) return;
      const hulkLookInput = v.root.querySelector('#xeno-para-hulk-look');
      if (hulkLookInput) chosenHulkLook = hulkLookInput.value.trim();
      api.xenoAct('startParasite', {
        kind: chosenParaSite === 'back_hulk' ? 'scion' : chosenParaKind,
        targetName: curTarget.name,
        site: chosenParaSite,
        form: chosenParaForm,
        mode: chosenParaMode,
        hulkFutaMode: chosenHulkFuta,
        hulkAppearance: chosenHulkLook
      });
      ctx.notify(`已对「${curTarget.name}」发动${chosenParaSite === 'back_hulk' ? '背面巨躯寄生' : (chosenParaKind === 'body' ? '本体化形寄生' : '分体子体寄生')}`);
      return;
    }
    if (act === 'para-update') {
      const kind = el.dataset.kind || 'scion';
      const targetName = el.dataset.target || curTarget?.name || '';
      const field = el.dataset.field;
      const val = el.dataset.val;
      if (!field) return;
      api.xenoAct('updateParasite', {
        kind,
        targetName,
        patch: {[field]: val}
      });
      ctx.notify(`已更新「${targetName}」的寄生状态`);
      return;
    }
    if (act === 'para-save-hulk-look') {
      const targetName = el.dataset.target || '';
      const inputEl = v.root.querySelector(`[data-hulk-look-for="${CSS.escape(targetName)}"]`);
      const hulkAppearance = inputEl ? inputEl.value.trim() : '';
      api.xenoAct('updateParasite', {
        kind: 'scion',
        targetName,
        patch: {hulkAppearance}
      });
      ctx.notify(hulkAppearance ? `已保存「${targetName}」的背面巨躯自定义外观` : `已恢复「${targetName}」的巨躯默认外观（衍生自目标自身特征）`);
      return;
    }
    if (act === 'para-release') {
      const kind = el.dataset.kind || 'scion';
      const targetName = el.dataset.target || curTarget?.name || '';
      const branch = el.dataset.branch || '正常剥离（抹除记忆并合理化）';
      api.xenoAct('releaseParasite', {kind, targetName, branch});
      ctx.notify(`已对「${targetName}」执行寄生脱离：${branch}`);
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

    if (act === 'mod-gender') {
      api.xenoAct('applyBodyMod', {targetKey: xeno.bodyModTarget, patch: {gender: el.dataset.gender}});
      ctx.notify(`肉体性别已改造为：${el.dataset.gender}`);
      return;
    }
    if (act === 'mod-tail') {
      api.xenoAct('applyBodyMod', {targetKey: xeno.bodyModTarget, patch: {predatorTail: el.dataset.tail}});
      ctx.notify('丸吞尾状态已更新');
      return;
    }
    if (act === 'mod-pick-fav-voice') {
      const entity = getEntity(xeno, xeno.bodyModTarget || '__protagonist__') || xeno.protagonist;
      openVoicePoolPickerDialog(ctx, {
        currentValue: entity.voiceRole || '',
        onSelect: (ref, label) => {
          api.xenoAct('applyBodyMod', {
            targetKey: xeno.bodyModTarget,
            patch: {voiceRole: ref}
          });
          ctx.notify(ref ? `当前肉体声带已绑定至${label}` : '已恢复默认本人音色');
        }
      });
      return;
    }
    if (act === 'mod-save-body') {
      const appearance = v.root.querySelector('#xeno-mod-appearance')?.value?.trim() ?? '';
      const bodyBuild = v.root.querySelector('#xeno-mod-body')?.value?.trim() ?? '';
      const physiology = v.root.querySelector('#xeno-mod-phys')?.value?.trim() ?? '';
      const voiceRole = v.root.querySelector('#xeno-mod-voice-role')?.value?.trim() ?? '';
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.bodyModTarget,
        patch: {appearance, bodyBuild, physiology, voiceRole}
      });
      ctx.notify('肉体改造已生效');
      return;
    }
    if (act === 'mod-save-cog') {
      const relationOverride = v.root.querySelector('#xeno-cog-relation')?.value?.trim() ?? '';
      const fakeMemory = v.root.querySelector('#xeno-cog-memory')?.value?.trim() ?? '';
      api.xenoAct('applyCognitionMod', {
        targetKey: el.dataset.target || xeno.cogModTarget,
        relationOverride,
        fakeMemory
      });
      ctx.notify('认知覆写与虚假记忆已保存');
      return;
    }
    if (act === 'mod-add-rule') {
      const text = v.root.querySelector('#xeno-cog-new-rule')?.value?.trim() || '';
      if (!text) { ctx.notify('请先输入常识改写词条内容', {error: true}); return; }
      api.xenoAct('applyCognitionMod', {targetKey: el.dataset.target || xeno.cogModTarget, addRule: text});
      ctx.notify('已添加常识改写词条');
      return;
    }
    if (act === 'mod-preset-rule') {
      api.xenoAct('applyCognitionMod', {targetKey: el.dataset.target || xeno.cogModTarget, addRule: el.dataset.rule});
      ctx.notify('已植入预设常识词条');
      return;
    }
    if (act === 'mod-del-rule') {
      api.xenoAct('applyCognitionMod', {targetKey: el.dataset.target || xeno.cogModTarget, removeRuleId: el.dataset.id});
      return;
    }
    if (act === 'mod-toggle-rule') {
      api.xenoAct('applyCognitionMod', {targetKey: el.dataset.target || xeno.cogModTarget, toggleRuleId: el.dataset.id});
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
    if (act === 'select-body-mod-target') { api.xenoAct('selectBodyModTarget', {key: el.value}); return; }
    if (act === 'select-cog-mod-target') { api.xenoAct('selectCogModTarget', {key: el.value}); return; }
    if (act === 'mod-voice-role') {
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.bodyModTarget,
        patch: {voiceRole: el.value}
      });
      ctx.notify(el.value ? `当前肉体声带已绑定至「${formatVoiceRoleLabel(el.value, api.getState().voicePool || [])}」` : '已恢复默认本人音色');
      return;
    }
    if (act === 'mod-orifice') {
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.bodyModTarget,
        patch: {orificeMods: {[el.dataset.slot]: el.value}}
      });
      return;
    }
    if (act === 'mod-venom') {
      api.xenoAct('applyBodyMod', {
        targetKey: xeno.bodyModTarget,
        patch: {orificeMods: {venomType: el.value}}
      });
      return;
    }
  });

  v.refresh();
  return v;
}
