---
name: commit
description: Cria um git commit no padrão Conventional Commits, uma única linha de até 75 caracteres, a partir das alterações pendentes (staged + unstaged) no repositório. Atualiza epic/todo.md marcando stories concluídas quando aplicável.
---

# Skill: `/commit`

## Quando rodar
- Disparada pelo hook `PostToolUse` após `Edit`, `Write` ou `MultiEdit`.
- Pode também ser invocada manualmente pelo usuário com `/commit`.

## Granularidade (importante)
- **1 commit por alteração lógica.** Não acumular múltiplos arquivos não-relacionados em um único commit "final".
- Quando o assistente estiver executando um plano com várias etapas, rodar `/commit` **após cada etapa** (cada arquivo ou cada grupo coeso), não só no final.
- Se um único Edit toca 1 arquivo com escopo claro → commit imediato.
- Se o Edit é parte de um conjunto inseparável (ex.: schema + normalizer + persistence precisam ir juntos para um teste passar) → commit ao fechar o grupo, ainda assim o mais cedo possível.

## Procedimento

1. **Verificar mudanças pendentes**
   - Rodar `git status --porcelain`. Se a saída for vazia, **abortar silenciosamente** (não há nada a commitar).

2. **Inspecionar o diff**
   - Rodar `git diff` (unstaged) e `git diff --cached` (staged) para entender o que mudou.
   - Rodar `git log --oneline -5` para alinhar com o estilo recente do projeto.

3. **Atualizar `epic/todo.md` se aplicável**
   - Se algum arquivo alterado pertence ao escopo de uma Story listada em `epic/todo.md` (ex.: `extension/background.js` → ST-002), marcar a checkbox correspondente como `[x]` com Edit, **antes** do commit.

4. **Compor a mensagem**
   - Formato estrito: `<type>(<scope>): <subject>`
   - `type` ∈ `{feat, fix, chore, docs, refactor, test, build, ci, perf, style}`
   - `scope` opcional: nome curto do módulo (`ext`, `api`, `db`, `infra`, `skill`)
   - `subject` em **minúsculas**, modo imperativo, **sem ponto final**.
   - **Limite duro:** `len(mensagem_completa) <= 75`. Se exceder, encurtar o subject.

5. **Commitar**
   - `git add -A`
   - `git commit -m "<mensagem>"`
   - **Nunca** usar `--no-verify`, **nunca** `--amend`.
   - Se um pre-commit hook falhar, **não** tentar de novo automaticamente — reportar a falha e parar.

6. **Confirmar**
   - Exibir `git log --oneline -1` para feedback rápido.

## Exemplos válidos
```
feat(ext): badge MV3 com escopo tabId
fix(api): create_model lida com schema sem properties
chore(db): adiciona rollback ao changeset olx-001
docs: atualiza README com fluxo docker
refactor(api): extrai normalizer para módulo próprio
test(api): cobre 422 em domain_id ausente
```

## Anti-exemplos (rejeitar)
```
✘ "feat(ext): adiciona um sistema completo de badge dinâmico para a extensão" (>75 chars)
✘ "Added background.js" (sem type, capitalizado, em inglês inconsistente)
✘ "fix: BUG." (ponto final, vago)
```

## Restrições
- Nunca commitar arquivos que pareçam conter segredos (`.env`, `*.pem`, `credentials.json`). Se detectados em `git status`, avisar e abortar.
- Nunca usar `git add` com caminhos genéricos como `*` se houver arquivos suspeitos não rastreados — preferir adicionar arquivos por nome.
