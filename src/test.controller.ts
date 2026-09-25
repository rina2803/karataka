import { Controller, Get, Header } from '@nestjs/common';

@Controller('test')
export class TestController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page() {
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lalao sy Karataka — Test API</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #f4f8ff; color: #10244a; }
    main { max-width: 560px; margin: 0 auto; padding: 32px 18px; }
    .card { background: white; border: 1px solid #d8e6f6; border-radius: 20px; padding: 22px; box-shadow: 0 12px 30px #7397c733; }
    h1 { margin: 0 0 6px; font-size: 25px; }
    p { color: #5c6b7a; }
    label { display: block; margin: 14px 0 6px; font-weight: 700; font-size: 13px; }
    input { box-sizing: border-box; width: 100%; border: 1px solid #d8e6f6; border-radius: 12px; padding: 13px; font-size: 16px; }
    button { border: 0; border-radius: 12px; padding: 13px 16px; margin-top: 16px; background: #1468e8; color: white; font-weight: 700; cursor: pointer; }
    button.secondary { background: #e8f4ff; color: #1468e8; margin-left: 8px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f5f9ff; border-radius: 12px; padding: 14px; min-height: 42px; }
    .ok { color: #16845a; } .error { color: #b43c35; }
  </style>
</head>
<body>
<main>
  <div class="card">
    <h1>Lalao sy Karataka</h1>
    <p>Page publique de vérification du backend de test.</p>
    <button id="health">Tester /health</button>
    <hr>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" placeholder="seed@lalao.test">
    <label for="password">Mot de passe</label>
    <input id="password" type="password" autocomplete="current-password" placeholder="Mot de passe">
    <button id="login">Tester la connexion</button>
    <button class="secondary" id="clear">Effacer</button>
    <pre id="result">Résultat des tests affiché ici.</pre>
  </div>
</main>
<script>
  const result = document.querySelector('#result');
  const show = (value, ok) => {
    result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    result.className = ok ? 'ok' : 'error';
  };
  document.querySelector('#health').onclick = async () => {
    show('Test en cours...', true);
    try {
      const response = await fetch('/health', { headers: { Accept: 'application/json' } });
      const data = await response.json();
      show({ http: response.status, ...data }, response.ok && data.ok === true);
    } catch (error) { show('Erreur réseau : ' + error.message, false); }
  };
  document.querySelector('#login').onclick = async () => {
    const email = document.querySelector('#email').value.trim();
    const password = document.querySelector('#password').value;
    if (!email || !password) return show('Saisis un email et un mot de passe.', false);
    show('Connexion en cours...', true);
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      show({ http: response.status, ok: response.ok, user: data.user, message: data.message }, response.ok);
    } catch (error) { show('Erreur réseau : ' + error.message, false); }
  };
  document.querySelector('#clear').onclick = () => {
    document.querySelector('#email').value = '';
    document.querySelector('#password').value = '';
    show('Résultat des tests affiché ici.', true);
  };
</script>
</body>
</html>`;
  }
}
