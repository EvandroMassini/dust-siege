# FPS Arena — Deserto II

Jogo FPS single-player de sobrevivência por ondas, rodando direto no navegador (Three.js r147, sem build).
Mapa de deserto inspirado em Dust II: ruas, prédios, plataformas, rampas, escadas, túnel e passarela.

## Recursos
- Mapa com física própria (colisão AABB, rampas, degraus, plataformas) e iluminação/sombras em tempo real
- Texturas PBR (normal map), props e armas 3D
- 6 armas: pistola, SMG, fuzil, escopeta, sniper (com luneta) e lançador de foguetes; mira com botão direito
- Inimigos com IA: patrulha, investigação, combate, cobertura, flanco, percepção por visão e audição, pathfinding A*
- 4 tipos de inimigo (soldado, rusher, sniper, pesado) e ondas progressivas; drops de vida e munição
- Áudio posicional 3D (HRTF), reverb e sons de passos, recarga, dor e morte
- 4 dificuldades (Fácil, Normal, Difícil, Deus), recorde por dificuldade, pausa automática

## Como rodar
O jogo precisa ser servido por HTTP (não abre direto por `file://`):

```bash
python -m http.server 8000     # na pasta do projeto
# abra http://localhost:8000/
```
Ou coloque a pasta no `htdocs` do XAMPP e abra `http://localhost/fps/`.

## Controles
WASD mover • Mouse mirar • Clique atirar • Botão direito mirar/luneta • R recarregar • Espaço pular •
Shift/C agachar • 1–6, Q e roda do mouse para trocar de arma • Esc libera o mouse (pausa).

## Créditos
Veja [CREDITOS.md](CREDITOS.md). Os assets têm licenças próprias (CC0 / CC-BY 3.0); respeite-as ao redistribuir.
