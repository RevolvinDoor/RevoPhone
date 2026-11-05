// App registry. Adding an app: add an entry here, register its factory in phone.js,
// and place its id on the home screen below (a reserved slot is replaced by the id).
//   colors: [tile top, tile bottom / glyph shade, glyph accent]
export const APPS = {
  xeno: {name: '异构终端', eyebrow: 'Xeno Terminal', colors: ['#ffb2e6', '#8b3dff', '#7ef9ff']},
  wardrobe: {name: '衣柜', eyebrow: 'Living Wardrobe', colors: ['#ffd1e8', '#e04f8b', '#fff29c']},
  mall: {name: '购物商城', eyebrow: 'Xeno Boutique', colors: ['#ffe2a8', '#f07b3f', '#a8f5d2']},
  logs: {name: '日志', eyebrow: 'Logs', colors: ['#b9d9ed', '#557c9e', '#a7f3cb']},
  roles: {name: '角色', eyebrow: 'Character', colors: ['#9ad8ff', '#4a9af0', '#ff9dbb']},
  engines: {name: '引擎', eyebrow: 'Wallet', colors: ['#cdb6ff', '#8a6cf2', '#fff09a']},
  presets: {name: '预设', eyebrow: 'Preset', colors: ['#ffe39c', '#ffac3f', '#ff7f86']},
  library: {name: '音频收藏', eyebrow: 'Voice Library', colors: ['#ffb6cc', '#ee6690', '#fff0a0']},
  gallery: {name: '相册', eyebrow: 'Album', colors: ['#ffcfb0', '#ff8d69', '#8fd1ff']},
  notes: {name: '备忘录', eyebrow: 'Memo', colors: ['#fff4b3', '#f6c53c', '#ff9d5c']},
  listen: {name: '听取', eyebrow: 'Now Playing', colors: ['#ffa3c3', '#e9588e', '#fff09a']},
  settings: {name: '设置', eyebrow: 'Settings', colors: ['#e4e8f0', '#98a2b6', '#ffd36a']},
  draw: {name: '绘图', eyebrow: 'NovelAI', colors: ['#c3c3ff', '#6d6ff0', '#ffd46a']},
  chat: {name: '聊天', eyebrow: 'Messages', colors: ['#8fd8ff', '#3d8ff0', '#ff9dbb']},
  forum: {name: '论坛', eyebrow: 'Forum', colors: ['#b8f0d0', '#38b07a', '#ffd36a']},
  peek: {name: '查手机', eyebrow: 'Peek', colors: ['#ffc6e0', '#c85a9a', '#9fe0ff']},
  sounds: {name: '音效', eyebrow: 'Ambience', colors: ['#a8e6e0', '#2f9e95', '#ffe08a']},
  assistant: {name: '助手', eyebrow: 'Assistant', colors: ['#c1b9ff', '#7869d7', '#ffe7a4']}
};

export const SLOT = null;

// Home screen: page 1 sits under the clock and widgets; later pages hold apps to come. Reserved places (SLOT) are not
// shown, and a page with only reserved places is left out.
export const HOME = {
  pages: [
    ['xeno', 'wardrobe', 'mall', 'roles', 'engines', 'presets', 'forum', 'peek'],
    ['library', 'gallery', 'notes', 'sounds', 'assistant', 'logs']
  ],
  dock: ['chat', 'draw', 'listen', 'settings']
};

export const appName = id => APPS[id]?.name || id;
