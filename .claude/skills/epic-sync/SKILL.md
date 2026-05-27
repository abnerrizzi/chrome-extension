---
name: epic-sync
description: Logo após um plano ser aprovado (saída do plan mode), ANTES de escrever qualquer código, transforma as tarefas do plano em Epics/Stories no epic/todo.md e mantém o arquivo sincronizado durante toda a execução (marca [x] ao concluir, adiciona stories descobertas). Invocar como primeiro passo da execução de um plano; também pode ser chamada manualmente com /epic-sync.
---

# Skill: `/epic-sync`

`epic/todo.md` é o rastreador canônico de tarefas (Epics ↔ Stories). Esta skill garante que **toda execução de plano começa registrando o trabalho no `epic/todo.md`** e que o arquivo reflete o progresso real até o fim — não um update apressado só no último commit.

## Quando rodar

- **Primeiro passo após aprovar um plano** (logo depois do `ExitPlanMode`), **antes** de qualquer `Edit`/`Write` de código. Se o assistente acabou de sair do plan mode para implementar uma feature multi-step, deve rodar esta skill antes de tocar o código.
- Sempre que **novas stories surgirem** durante a execução (trabalho descoberto que não estava no plano).
- Invocada manualmente com `/epic-sync` para reconciliar `epic/todo.md` com o estado atual.

## Anti-trigger (não rodar)

- Mudança trivial de 1 arquivo sem plano associado (ex.: corrigir um typo, ajustar um teste).
- Quando o pedido não tem etapas rastreáveis (pergunta, exploração read-only).
- Edição isolada de docs.

## Procedimento

1. **Recuperar o plano aprovado**
   - Ler o plan file (quando existir, ex.: `~/.claude/plans/<slug>.md`) ou o resumo aprovado na conversa. Extrair a lista de etapas/entregáveis.

2. **Ler o estado atual**
   - Abrir `epic/todo.md`. Identificar a numeração em uso (último `EPIC-NNN` e `ST-NNN`) para continuar a sequência sem colidir.

3. **Mapear plano → Epics/Stories (antes de codar)**
   - Agrupar as etapas do plano sob **um EPIC novo** (`EPIC-NNN — <título curto>`) ou anexar stories a um EPIC existente quando o tema já existe.
   - Criar uma Story por etapa coesa, no formato `- [ ] ST-NNN <descrição imperativa curta>`. Incluir nomenclatura interna útil (arquivo/função/escopo) na descrição, como nas stories existentes.
   - Escrever **todas como `[ ]` (pendentes)** neste momento. Não marcar nada ainda.
   - Se uma story antiga vira obsoleta/substituída, anotar (`**substituída por ST-NNN**`) em vez de apagar o histórico.

4. **Manter sincronizado durante a execução**
   - Ao concluir uma story, marcar `[x]` — preferencialmente **junto do `/commit`** daquela etapa (a skill `/commit` já marca checkboxes quando um arquivo alterado mapeia para uma story; esta skill garante que a story **existe** para ser marcada).
   - Ao descobrir trabalho novo, **adicionar** a story (pendente) assim que perceber, não no fim.
   - Nunca marcar `[x]` prematuramente: só quando a etapa está realmente feita (testes passando / arquivo entregue).

5. **Fechamento**
   - Antes de encerrar a feature, conferir que todas as stories do EPIC estão `[x]` ou explicitamente anotadas como adiadas/fora de escopo. Reportar pendências.

## Formato (mesmo do arquivo)

```
## EPIC-NNN — <Título do épico>
- [ ] ST-NNN <descrição da story (escopo: arquivo/módulo)>
- [x] ST-NNN <story concluída>
```

- Numeração **contínua** com o que já existe no arquivo (não reiniciar).
- `type/scope` na descrição segue o vocabulário do projeto (`ext`, `api`, `db`, `olx`, `infra`, `skill`, `ci`).

## Integração com as outras skills

- **`/feature-branch`** posiciona o branch → **`/epic-sync`** registra as stories → implementação → **`/commit`** por etapa (marca `[x]`).
- `/epic-sync` e `/commit` são complementares: `/epic-sync` **cria/ordena** as stories a partir do plano; `/commit` as **fecha** conforme os arquivos mudam.

## Restrições

- Editar **apenas** `epic/todo.md` (e, se necessário para contexto, ler o plan file). Não tocar código.
- Não duplicar stories já existentes — reconciliar, não recriar.
- Não apagar Epics/Stories históricos; marcar como concluídos, substituídos ou adiados.
