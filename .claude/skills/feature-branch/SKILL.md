---
name: feature-branch
description: Garante que toda nova feature começa em um branch dedicado, criado a partir de um branch base escolhido pelo usuário (branch atual, main/master ou develop), com nomenclatura no padrão Conventional Commits (feat|fix|chore|...).
---

# Skill: `/feature-branch`

Garante que toda nova feature começa em um branch dedicado. O branch base é **sempre escolhido pelo usuário** (branch atual, `main`/`master`, `develop` ou outro) — o skill pergunta antes de criar.

## Quando rodar

- **Antes** de qualquer trabalho que adicione uma nova feature, refactor relevante, fix não-trivial, ou módulo novo.
- Invocada manualmente pelo usuário com `/feature-branch <slug>` (o `<slug>` é opcional — se ausente, o assistente sugere um a partir do contexto).
- Se o assistente perceber que o branch atual já é `master`/`main` no início de um pedido de feature, deve **rodar este skill primeiro**, antes de qualquer Edit/Write.

## Anti-trigger (não rodar)

- Pequenas correções em branches já abertas (ex.: usuário pediu para ajustar um teste num PR em andamento).
- Edição de docs isolada.
- Quando o usuário explicitamente pediu para trabalhar no branch atual ("não cria branch novo, edita aqui mesmo").

## Procedimento

1. **Verificar working tree limpo**
   - Rodar `git status --porcelain`. Se houver pendências:
     - Mudanças relacionadas à feature ainda não iniciada são **inesperadas**: parar e perguntar ao usuário se quer commitar, stashear ou descartar.
     - **Nunca** stashar/descartar sem confirmação explícita.

2. **Escolher o branch base — SEMPRE perguntar**
   - **Sempre** perguntar ao usuário a partir de qual branch criar, via `AskUserQuestion`. Não assumir `main` por padrão.
   - Montar as opções dinamicamente a partir do repo:
     - **Branch atual** (`git rev-parse --abbrev-ref HEAD`) — útil para empilhar sobre trabalho ainda não mergeado (ex.: um fix sobre um PR aberto).
     - **`main`/`master`** (o que existir, via `git show-ref --verify --quiet refs/heads/main` / `refs/heads/master`).
     - **`develop`** e quaisquer outros branches de integração de longa duração que existam (`git branch --format='%(refname:short)'`).
   - Recomendar a opção mais provável pelo contexto (ex.: se o trabalho depende de um PR aberto, sugerir o branch atual; senão, `main`), marcando-a como "(Recomendado)" — mas a escolha é do usuário. O branch escolhido vira `$BASE`.
   - Se houver mudanças não-commitadas (passo 1) e `$BASE` for diferente do branch atual, confirmar antes de trocar — nunca perder trabalho.

3. **Atualizar a base**
   - `git checkout $BASE`
   - Se `$BASE` tiver upstream em `origin`: `git pull --ff-only origin $BASE`. **Nunca** `--rebase`/`--force` aqui. (Branches locais sem upstream — ex.: um PR local — não precisam de pull.)
   - Se o `--ff-only` falhar (divergência local), parar e reportar — não tentar resolver automaticamente.

4. **Compor o nome do branch**
   - Formato: `<type>/<scope>-<subject-kebab>`
     - `type` ∈ `{feat, fix, chore, docs, refactor, test, build, ci, perf, style}` — mesmo vocabulário do skill de commit.
     - `scope` opcional, mesma lista (`ext`, `api`, `db`, `infra`, `skill`, `ci`).
     - `subject-kebab` em minúsculas, hífen-separado, **máx 40 chars** após o prefixo `type/scope-`.
   - Se o usuário passou um argumento (`/feature-branch foo-bar`), usa direto como subject; o `type` é inferido (feature por default = `feat`) e o `scope` opcional pode ser pedido por `AskUserQuestion` se o contexto não deixar óbvio.
   - Se não passou nada, sugere um nome a partir do pedido em curso e confirma antes de criar.

5. **Criar e checar**
   - `git checkout -b <branch-name>`
   - Confirma com `git status --short --branch` para visibilidade.

6. **Retomar o trabalho**
   - Após o checkout bem-sucedido, prosseguir com a tarefa original. Não commitar nada ainda — o skill **só** posiciona o branch.

## Exemplos válidos

```
feat/ext-linkedin-detail-parser
fix/api-upsert-coalesce
refactor/db-changelog-rename
chore/infra-bump-postgres-16
test/api-linkedin-fixtures
```

## Anti-exemplos (rejeitar)

```
✘ adiciona-detail-parser            (sem type/)
✘ feat/this-is-a-very-long-branch-name-that-keeps-going-and-going  (>40 chars no subject)
✘ Feature/ExtLinkedin               (PascalCase, espaços)
✘ feat/ext_linkedin                 (underscore — usar hífen)
```

## Restrições

- Nunca usar `git push --force` ou `--force-with-lease` neste skill.
- Nunca deletar o branch atual sem confirmação — o usuário pode ter trabalho não-commitado.
- Nunca trocar de branch se houver mudanças não-commitadas que possam ser perdidas (mesmo que `git checkout` permitisse via merge automático).
- Se o repo não tiver `master` nem `main` (ex.: trunk diferente), parar e perguntar qual é a branch base.
