// This is an OAuth callback, not a preview page. It neither stores nor exchanges credentials.
const status = document.getElementById('status');
const params = new URL(location.href).searchParams;
if (!params.has('state') || !(params.has('code') || params.has('error'))) {
  status.textContent = '这里是 Fish 登录回调页，请从 RevoPhone 的 Fish 引擎开始连接账户。';
} else if (window.opener) {
  window.opener.postMessage({type: 'revophone-fish-oauth', url: location.href}, location.origin);
  status.textContent = '已发送授权结果。请返回 RevoPhone 查看连接状态。';
} else {
  status.textContent = '此宿主未保留原窗口，请按下方说明手动传回登录地址。';
}
