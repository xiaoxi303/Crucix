export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'fr'];
export const DEFAULT_LOCALE = 'zh-CN';

const META = {
  'zh-CN': { code: 'zh-CN', name: 'Chinese Simplified', nativeName: '中文' },
  en: { code: 'en', name: 'English', nativeName: 'English' },
  fr: { code: 'fr', name: 'French', nativeName: 'Français' },
};

const LOCALES = {
  'zh-CN': {
    meta: META['zh-CN'],
    dashboard: {
      title: 'CRUCIX 情报终端',
      sweep: '情报扫描',
      sources: '数据源',
      delta: '变化',
      highAlert: '高警戒',
      riskOff: 'RISK-OFF 避险',
      riskOn: 'RISK-ON 风险偏好',
      mixed: '混合',
      terminalActive: '终端在线',
      guideBtn: '信号说明',
      visuals: '视觉',
      visualsLite: '轻量',
      visualsFull: '完整',
    },
    boot: {
      initializing: '正在启动 CRUCIX 情报引擎 v2.1.0',
      connecting: '连接 {count} 个开源情报 OSINT 数据源...',
      sourceGroup1: 'OPENSKY · FIRMS · KIWISDR · MARITIME',
      sourceGroup2: 'FRED · BLS · EIA · TREASURY · GSCPI',
      sourceGroup3: 'TELEGRAM · SAFECAST · EPA · WHO · OFAC',
      sourceGroup4: 'GDELT · NOAA · PATENTS · BLUESKY · REDDIT',
      sweepComplete: '情报扫描完成 · {ok}/{total} 数据源',
      ok: '正常',
      acledLayer: 'ACLED 冲突图层',
      flightCorridors: '飞行走廊',
      active: '在线',
      dualProjection: '双投影',
      ready: '就绪',
      intelligenceSynthesis: '情报合成',
    },
    panels: {
      sensorGrid: '传感器矩阵',
      tradeIdeas: '可执行观察',
      osintFeed: 'OSINT 信息流',
      osintStream: 'OSINT 流',
      nuclearWatch: '核设施监测',
      newsTicker: '实时新闻带',
      sweepDelta: '扫描变化',
      macroMarkets: '宏观 + 市场',
      crossSourceSignals: '跨源信号',
      signalCore: '信号核心',
    },
    layers: {
      airActivity: '空域活动',
      thermalSpikes: '热异常',
      sdrCoverage: 'SDR 覆盖',
      maritimeWatch: '海事监测',
      nuclearSites: '核设施',
      conflictEvents: '冲突事件',
      healthWatch: '公共卫生',
      worldNews: '世界新闻',
      osintFeed: 'OSINT 信息流',
      theaters: '战区',
      nightDet: '夜间探测',
      online: '在线',
      chokepoints: '咽喉要道',
      monitors: '监测点',
      fatalities: '死亡',
      whoAlerts: 'WHO 警报',
      rssGeolocated: 'RSS 地理定位',
      spaceActivity: '卫星活动',
    },
    map: {
      worldNews: '世界新闻',
      healthAlert: '健康警报',
      chokepoint: '咽喉要道',
      nuclearSite: '核设施',
      osintEvent: 'OSINT 事件',
      thermalDetection: '热探测',
      aircraft: '航空器',
      airTraffic: '空中交通',
      thermalFire: '热源/火点',
      conflict: '冲突',
      sdrReceiver: 'SDR 接收器',
      scrollToZoom: '滚轮缩放 · 拖拽平移',
      globeMode: '地球模式',
      flatMode: '平面模式',
      gdeltEvent: 'GDELT 事件',
    },
    ideas: {
      confidence: '置信度',
      risk: '风险',
      aiEnhanced: 'AI 增强',
      llmOff: 'LLM 关闭',
      pending: '等待中',
      llmNotConfigured: '未配置 LLM',
      llmHelp: '在 Cloudflare Secrets 中设置 LLM_PROVIDER 和 LLM_API_KEY 后启用 AI 观察',
      disclosure: '仅供信息参考，不构成投资建议。所有观察来自公开数据与信号合成，投资前请咨询持牌专业人士。',
    },
    regions: {
      world: '全球',
      americas: '美洲',
      europe: '欧洲',
      middleEast: '中东',
      asiaPacific: '亚太',
      africa: '非洲',
    },
    badges: {
      radiation: '辐射',
      live: '实时',
      delayed: '延迟',
      items: '条目',
      urgent: '紧急',
      worldview: '全局视图',
      hotMetrics: '热指标',
      sweeping: '扫描中...',
    },
    delta: {
      baseline: '基线',
      noChanges: '距上次扫描暂无显著变化',
      changes: '变化',
      critical: '关键',
      new: '新增',
      'risk-off': 'RISK-OFF 避险',
      'risk-on': 'RISK-ON 风险偏好',
      mixed: '混合',
    },
    nuclear: {
      allSitesNormal: '所有站点正常',
      anomalyDetected: '发现异常',
      noData: '无数据',
    },
    space: {
      newLast30d: '近 30 日新增',
    },
    time: {
      justNow: '刚刚',
      hoursAgo: '{hours}小时前',
      daysAgo: '{days}天前',
    },
    api: {
      errors: {
        noDataYet: '暂无数据，首次情报扫描仍在进行',
      },
    },
  },
  en: {
    meta: META.en,
    dashboard: {
      title: 'CRUCIX Intelligence Terminal',
      sweep: 'SWEEP',
      sources: 'SOURCES',
      delta: 'DELTA',
      highAlert: 'HIGH ALERT',
      riskOff: 'RISK-OFF',
      riskOn: 'RISK-ON',
      mixed: 'MIXED',
      terminalActive: 'TERMINAL ACTIVE',
      guideBtn: 'What Signals Mean',
      visuals: 'VISUALS',
      visualsLite: 'LITE',
      visualsFull: 'FULL',
    },
  },
  fr: { meta: META.fr },
};

export function normalizeLanguage(input, fallback = DEFAULT_LOCALE) {
  if (!input) return fallback;
  const raw = String(input).trim();
  const lower = raw.toLowerCase();
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh_hans') return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('fr')) return 'fr';
  return fallback;
}

export function getRuntimeLocale(lang) {
  const normalized = normalizeLanguage(lang);
  return LOCALES[normalized] || LOCALES[DEFAULT_LOCALE];
}

export function getSupportedLocaleInfo() {
  return SUPPORTED_LOCALES.map(code => META[code]);
}
