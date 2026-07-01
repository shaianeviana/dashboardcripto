import { tryLogin } from './auth'

export function mountLoginPage(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="login-bg">
      <div class="login-card">
        <div class="login-logo">₿</div>
        <h2 class="login-title">Crypto Dashboard</h2>
        <p class="login-sub">Acesso restrito — faça login para continuar</p>
        <form id="login-form" autocomplete="off" novalidate>
          <div class="login-field">
            <label for="lu">Usuário</label>
            <input id="lu" type="text" placeholder="Digite o usuário" autocomplete="username" />
          </div>
          <div class="login-field">
            <label for="lp">Senha</label>
            <input id="lp" type="password" placeholder="Digite a senha" autocomplete="current-password" />
          </div>
          <p id="lerr" class="login-err" aria-live="polite"></p>
          <button type="submit" id="login-btn">Entrar</button>
        </form>
      </div>
    </div>
  `

  const form  = document.getElementById('login-form') as HTMLFormElement
  const errEl = document.getElementById('lerr')       as HTMLElement
  const btn   = document.getElementById('login-btn')  as HTMLButtonElement

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errEl.textContent = ''

    const u = (document.getElementById('lu') as HTMLInputElement).value.trim()
    const p = (document.getElementById('lp') as HTMLInputElement).value

    btn.disabled    = true
    btn.textContent = 'Verificando...'

    await new Promise(r => setTimeout(r, 480))

    if (tryLogin(u, p)) {
      btn.textContent = 'Entrando...'
      await new Promise(r => setTimeout(r, 280))
      location.reload()
    } else {
      btn.disabled    = false
      btn.textContent = 'Entrar'
      errEl.textContent = 'Usuário ou senha incorretos'
      const card = document.querySelector('.login-card') as HTMLElement
      card.classList.add('shake')
      setTimeout(() => card.classList.remove('shake'), 580)
    }
  })
}
