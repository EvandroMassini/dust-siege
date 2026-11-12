# Dust Siege

FPS single-player de sobrevivência por ondas que roda direto no navegador (Three.js r147, sem build).
Mapa de deserto inspirado em Dust II: ruas, prédios, plataformas, rampas, escadas, túnel e passarela.

▶ **Jogar online:** `https://SEU_USUARIO.github.io/dust-siege/` (publicado automaticamente pelo GitHub Pages a cada push na branch `main`)

## Recursos
- Mapa com física própria (colisão AABB, rampas, degraus, plataformas) e iluminação/sombras em tempo real
- Texturas PBR (normal map), props e armas 3D
- 6 armas: pistola, SMG, fuzil, escopeta, sniper (com luneta) e lançador de foguetes; mira com botão direito
- Inimigos com IA: patrulha, investigação, combate, cobertura, flanco, percepção por visão e audição, pathfinding A*
- 4 tipos de inimigo (soldado, rusher, sniper, pesado) e ondas progressivas; drops de vida e munição
- Áudio posicional 3D (HRTF), reverb e sons de passos, recarga, dor e morte
- 4 dificuldades (Fácil, Normal, Difícil, Deus), recorde por dificuldade, pausa automática

## Controles
WASD mover • Mouse mirar • Clique atirar • Botão direito mirar/luneta • R recarregar • Espaço pular •
Shift/C agachar • 1–6, Q e roda do mouse para trocar de arma • Esc libera o mouse (pausa).

## Como rodar localmente
O jogo precisa ser servido por HTTP (não abre direto por `file://`):

```bash
python -m http.server 8000     # na pasta do projeto
# abra http://localhost:8000/
```
Ou coloque a pasta no `htdocs` do XAMPP.

### Ambiente na nuvem (sem instalar nada)
- **GitHub Pages:** o workflow `.github/workflows/pages.yml` publica o jogo automaticamente. Na primeira vez, em *Settings → Pages*, escolha **Source: GitHub Actions** (se ainda não estiver).
- **GitHub Codespaces:** *Code → Codespaces → Create codespace*. O ambiente (`.devcontainer/`) sobe um servidor local e abre o jogo na porta 8000.

## Como foi feito
Projeto desenvolvido com apoio de modelos de IA:

- **qwen3.8:27b** (local, via agente OllamaPilot)
- **Grok 4.7**
- **Claude Sonnet 5.5**

## Créditos e licenças
Veja [CREDITOS.md](CREDITOS.md). Os assets têm licenças próprias (CC0 / CC-BY 3.0); respeite-as ao redistribuir.
