const form = document.querySelector('#pair');
const origin = document.querySelector('#origin');
const code = document.querySelector('#code');
const error = document.querySelector('#error');
const status = document.querySelector('#status');
const submit = document.querySelector('#submit');
window.desktop
  .setupInfo()
  .then((info) => {
    origin.value = info.origin;
    origin.readOnly = info.preset;
    if (info.reconnecting)
      status.textContent = '正在连接网站，网络恢复后会自动重连。无需重新绑定。';
  })
  .catch((reason) => {
    error.textContent = reason.message;
  });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  submit.textContent = '正在连接…';
  error.textContent = '';
  try {
    await window.desktop.pairDevice({
      origin: origin.value.trim(),
      code: code.value.trim(),
      autoStart: document.querySelector('#auto-start').checked,
    });
    status.textContent = '绑定成功，正在进入教室…';
  } catch (reason) {
    error.textContent = reason.message.includes('fetch')
      ? '暂时连不上网站，请检查网络或把提示发给维护者。'
      : reason.message;
  } finally {
    submit.disabled = false;
    submit.textContent = '连接教室';
  }
});
