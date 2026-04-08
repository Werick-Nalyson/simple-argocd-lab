# ArgoCD Lab

Lab local para aprender e validar o **ArgoCD** como ferramenta de gerenciamento de cluster Kubernetes, usando **Kind** (Kubernetes in Docker) e um pipeline de CI/CD no **GitHub Actions**.

---

## O que é o ArgoCD?

O **ArgoCD** é uma ferramenta de entrega contínua declarativa para Kubernetes, baseada no paradigma **GitOps**. Ele trata o Git como única fonte de verdade para o estado desejado do cluster.

### O paradigma GitOps

No GitOps, em vez de executar `kubectl apply` em um pipeline de CI, você:

1. Commita o código da aplicação no Git
2. O GitHub Actions faz o build, publica a imagem no Docker Hub e **atualiza automaticamente** a tag em `k8s/kustomization.yaml`
3. O ArgoCD detecta a mudança no `kustomization.yaml` e reconcilia o cluster

```
git push (app/) → Actions: docker build+push → kustomize edit set image
                                                    ↓
                          ArgoCD detecta mudança no kustomization.yaml
                                                    ↓
                                    kubectl apply (automático)
```

### Por que GitOps?

| Benefício | Descrição |
|-----------|-----------|
| **Auditabilidade** | Cada mudança no cluster é um commit Git com autor e timestamp |
| **Rollback simples** | `git revert` desfaz qualquer mudança no cluster |
| **Drift detection** | ArgoCD alerta (e pode auto-corrigir) quando o cluster diverge do Git |
| **Segurança** | O pipeline CI não precisa de acesso direto ao cluster — só o ArgoCD precisa |
| **Revisão de código** | Mudanças em infra passam pelo mesmo processo de PR do código |

---

## Arquitetura do Lab

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub Repo                          │
│                                                             │
│  app/          ← código Node.js + Dockerfile               │
│  k8s/          ← manifestos K8s (ArgoCD observa aqui)      │
│  argocd/       ← Application manifest                      │
│  .github/      ← GitHub Actions workflow                   │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
               ▼                      ▼
   ┌───────────────────┐   ┌──────────────────────┐
   │  GitHub Actions   │   │       ArgoCD          │
   │  (push em app/)   │   │  (observa k8s/)       │
   │                   │   │                       │
   │  docker build     │   │  detecta mudança      │
   │  docker push      │   │  em kustomization.yaml│
   │  kustomize update │   │  reconcilia cluster   │
   │  git commit+push  │   │                       │
   └─────────┬─────────┘   └──────────┬────────────┘
             │                        │
             ▼                        ▼
   ┌───────────────────┐   ┌──────────────────────┐
   │    Docker Hub     │   │   Kind Cluster        │
   │                   │   │   (local)             │
   │  :latest          │   │                       │
   │  :sha-abc1234     │   │  namespace: argocdlab │
   └───────────────────┘   └──────────────────────┘
```

**Loop GitOps totalmente automatizado:**
1. Dev faz push do código em `app/`
2. GitHub Actions: build → push Docker Hub → `kustomize edit set image :sha-XXXXX` → commit+push em `k8s/kustomization.yaml`
3. ArgoCD detecta a mudança no `kustomization.yaml` e sincroniza o cluster
4. Novo pod sobe com a nova imagem — **zero intervenção manual**, nem mesmo na tag

---

## Pré-requisitos

Instale as ferramentas abaixo antes de começar:

| Ferramenta | Instalação |
|------------|------------|
| **Docker Desktop** | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| **kind** | `brew install kind` |
| **kubectl** | `brew install kubectl` |
| **ArgoCD CLI** | `brew install argocd` |
| **jq** (opcional) | `brew install jq` |

Contas necessárias:
- **GitHub** — para hospedar o repositório e rodar o Actions
- **Docker Hub** — para publicar a imagem Docker

---

## Passo a Passo

### Passo 1 — Substituir os placeholders

Antes de qualquer coisa, edite dois arquivos com suas credenciais:

**`k8s/deployment.yaml`** — substitua `YOUR_DOCKERHUB_USERNAME`:
```yaml
image: seunome/argocdlab-app:latest
```

**`argocd/application.yaml`** — substitua `YOUR_GITHUB_USERNAME`:
```yaml
repoURL: https://github.com/seunome/argocdlab.git
```

### Passo 2 — Gerar o lockfile do Node.js

O `Dockerfile` usa `npm ci`, que exige `package-lock.json`. Gere-o localmente:

```bash
cd app
npm install
cd ..
```

Commite o arquivo gerado:

```bash
git add app/package-lock.json
git commit -m "add package-lock.json"
```

### Passo 3 — Criar o repositório no GitHub e fazer push

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/SEU_USERNAME/argocdlab.git
git push -u origin main
```

### Passo 4 — Configurar secrets no GitHub

No repositório GitHub: **Settings → Secrets and variables → Actions → New repository secret**

Crie dois secrets:

| Nome | Valor |
|------|-------|
| `DOCKERHUB_USERNAME` | Seu username no Docker Hub |
| `DOCKERHUB_TOKEN` | Token de acesso (Docker Hub → Account Settings → Security → New Access Token) |

### Passo 5 — Criar o cluster Kind

```bash
kind create cluster --config kind/cluster-config.yaml
```

Verifique se o contexto foi alternado corretamente:

```bash
kubectl config current-context
# deve mostrar: kind-argocdlab
```

> Se você tiver outros clusters Kind, garanta que está no contexto correto:
> ```bash
> kubectl config use-context kind-argocdlab
> ```

### Passo 6 — Instalar o ArgoCD no cluster

```bash
kubectl create namespace argocd

kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Aguardar o ArgoCD ficar pronto (pode levar ~2 minutos)
kubectl wait --for=condition=available --timeout=300s \
  deployment/argocd-server -n argocd
```

### Passo 7 — Expor a UI do ArgoCD via NodePort

O Kind já está configurado com as portas 30080 e 30443 mapeadas para o host. Basta converter o serviço do ArgoCD para NodePort:

```bash
kubectl patch svc argocd-server -n argocd \
  -p '{"spec":{"type":"NodePort","ports":[{"name":"https","port":443,"nodePort":30443,"protocol":"TCP"},{"name":"http","port":80,"nodePort":30080,"protocol":"TCP"}]}}'
```

Acesse a UI: **https://localhost:30443** (aceite o certificado self-signed)

### Passo 8 — Obter a senha inicial do admin

```bash
argocd admin initial-password -n argocd
```

### Passo 9 — Login no ArgoCD CLI

```bash
argocd login localhost:30443 \
  --username admin \
  --password <senha-do-passo-anterior> \
  --insecure
```

### Passo 10 — Verificar o pipeline automático

O push do Passo 3 disparou o workflow. O pipeline executa automaticamente:

1. Build e push da imagem Docker Hub com tags `latest` e `sha-XXXXXXX`
2. Atualiza `k8s/kustomization.yaml` com a nova tag via `kustomize edit set image`
3. Faz commit e push do `kustomization.yaml` atualizado de volta ao repositório

Acompanhe em: **GitHub → seu repositório → Actions**

Após o pipeline concluir, o arquivo `k8s/kustomization.yaml` no repositório terá:
```yaml
images:
  - name: wericknalyson/argocdlab-app
    newTag: sha-abc1234
```

### Passo 11 — Aplicar o Application do ArgoCD

```bash
kubectl apply -f argocd/application.yaml
```

Aguarde o sync inicial:

```bash
argocd app get argocdlab-app
```

Você deve ver `STATUS: Synced` e `HEALTH: Healthy`.

### Passo 12 — Acessar a aplicação

```bash
curl http://localhost:30081
```

Resposta esperada:
```json
{
  "message": "Hello from ArgoCD Lab!",
  "version": "1.0.0-sha-abc1234",
  "hostname": "argocdlab-app-7d9f8b-xk2p9",
  "uptime": "42s",
  "platform": "linux",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Demonstrando o GitOps (o momento "wow")

Esta é a parte mais importante do lab: ver o ArgoCD reconciliar o cluster automaticamente.

### Exemplo 1 — Escalar replicas

Edite `k8s/deployment.yaml`, mude `replicas: 2` para `replicas: 3`:

```yaml
spec:
  replicas: 3
```

Faça push e observe:

```bash
git add k8s/deployment.yaml
git commit -m "scale: increase replicas to 3"
git push

# Acompanhe o sync em tempo real
kubectl get pods -n argocdlab -w
```

O ArgoCD detecta a mudança e cria o terceiro pod sem nenhuma intervenção.

### Exemplo 2 — Drift detection (selfHeal)

Tente modificar o deployment manualmente (simulando alguém "furando" o GitOps):

```bash
kubectl scale deployment argocdlab-app -n argocdlab --replicas=1
```

Aguarde alguns segundos — o ArgoCD vai detectar o drift e restaurar para 3 replicas automaticamente.

### Exemplo 3 — Deploy de nova versão (totalmente automático)

1. Faça uma mudança em `app/src/index.js` (ex: mude a mensagem)
2. Faça push — o GitHub Actions constrói e publica a nova imagem
3. O pipeline atualiza automaticamente `k8s/kustomization.yaml` com a nova tag
4. O ArgoCD detecta a mudança e faz o rolling update
5. Observe: `kubectl get pods -n argocdlab -w`

Nenhuma intervenção manual necessária após o push.

---

## Segurança — Scan com Trivy

O pipeline inclui análise de segurança automática via **Trivy** (Aqua Security) antes de qualquer deploy. O scan roda no **Job 2** do workflow, entre o build e a atualização dos manifestos.

### O que é o Trivy?

Trivy é um scanner de segurança open source que cobre múltiplas superfícies de ataque em uma única ferramenta:

| Superfície | O que detecta |
|------------|---------------|
| **Imagem Docker** | CVEs em pacotes do OS (Alpine, Debian...) e dependências de linguagem |
| **Dockerfile** | Má configuração (root user, `latest` tag, ausência de HEALTHCHECK...) |
| **Manifestos Kubernetes** | Má configuração (sem limites de recursos, `privileged: true`, sem probes...) |
| **Código-fonte** | Secrets hardcoded (tokens, chaves, senhas) |

### Como funciona no pipeline

```
[Job 1] build-and-push
        ↓
[Job 2] scan ← Trivy roda aqui
   ├─ Scan da imagem: CRITICAL/HIGH fixável → exit-code 1 → bloqueia Job 3
   └─ Scan de IaC:    CRITICAL/HIGH         → exit-code 0 → reporta, não bloqueia
        ↓ (só se scan passou)
[Job 3] update-manifests → ArgoCD sync
```

O deploy **nunca acontece** se o scan da imagem encontrar vulnerabilidade com severidade `CRITICAL` ou `HIGH` que já tenha correção disponível (`ignore-unfixed: true`).

### Relatórios gerados

Como o repositório é **privado no plano GitHub Free**, o GitHub Advanced Security (Code Scanning) não está disponível. Os relatórios são salvos como **artefatos do workflow** e ficam disponíveis por 30 dias.

Para baixar e inspecionar:

```bash
# Listar execuções recentes do workflow
gh run list --workflow=build-push.yml

# Baixar os artefatos de uma execução específica
gh run download <run-id> --name trivy-reports-sha-abc1234

# Inspecionar vulnerabilidades da imagem
cat trivy-image.json | jq '
  .Results[].Vulnerabilities[]? |
  {pkg: .PkgName, cve: .VulnerabilityID, severity: .Severity, fixed: .FixedVersion}
'

# Inspecionar problemas de IaC
cat trivy-iac.json | jq '
  .Results[].Misconfigurations[]? |
  {id: .ID, title: .Title, severity: .Severity, resolution: .Resolution}
'
```

### Comparativo por plano GitHub

| Recurso | Repo privado (free) | Repo público | Enterprise |
|---------|--------------------|--------------|----|
| Log no Actions (table) | Sim | Sim | Sim |
| Artefato JSON para download | Sim | Sim | Sim |
| GitHub Security → Code scanning | Não | Sim | Sim |
| Bloqueia deploy se CRITICAL/HIGH | Sim | Sim | Sim |

> Para habilitar o GitHub Security no futuro (tornando o repo público ou migrando para Enterprise), substitua os steps `actions/upload-artifact` por `github/codeql-action/upload-sarif` no workflow — os resultados aparecerão em **Security → Code scanning alerts**.

### Outras ferramentas do ecossistema

Caso queira complementar ou substituir o Trivy:

| Categoria | Ferramenta | Destaque |
|-----------|-----------|----------|
| Container scan | **Grype** (Anchore) | Leve, bom output, integra com SBOM |
| Container scan | **Snyk Container** | SaaS, monitoramento contínuo |
| Container scan | **Docker Scout** | Nativo no Docker Hub |
| SAST | **Semgrep** | Regras customizáveis, multi-linguagem |
| SAST | **CodeQL** (GitHub) | Nativo no Actions, análise profunda |
| Dependências | **npm audit** | Nativo no Node.js, zero config |
| Dependências | **Dependabot** | Abre PRs automáticos de atualização |
| Secrets | **Gitleaks** | Scanneia o histórico Git inteiro |
| Secrets | **TruffleHog** | Detecta secrets por alta entropia |
| IaC | **Checkov** | Políticas como código, multi-cloud |
| IaC | **kube-score** | Score de segurança por manifesto K8s |
| Dockerfile | **Hadolint** | Lint + boas práticas |
| SBOM | **Syft** (Anchore) | Gera inventário completo da imagem |

**Exemplo — gerar SBOM e scanear com Grype localmente:**
```bash
# Instalar
brew install syft grype

# Gerar inventário (SBOM) da imagem
syft wericknalyson/argocdlab-app:latest -o spdx-json > sbom.json

# Scanear o SBOM por CVEs
grype sbom:sbom.json
```

---

## Cheatsheet de Comandos

```bash
# Status do Application no ArgoCD
argocd app get argocdlab-app

# Listar todos os apps
argocd app list

# Forçar sync manual (se não estiver em auto-sync)
argocd app sync argocdlab-app

# Ver histórico de deploys
argocd app history argocdlab-app

# Fazer rollback para versão anterior
argocd app rollback argocdlab-app <revision-id>

# Acompanhar pods
kubectl get pods -n argocdlab -w

# Ver logs de um pod
kubectl logs -n argocdlab -l app=argocdlab-app --tail=50

# Testar o endpoint da aplicação
curl http://localhost:30081 | jq

# Ver eventos do namespace
kubectl get events -n argocdlab --sort-by=.lastTimestamp

# Deletar tudo ao final do lab
kind delete cluster --name argocdlab
```

---

## Troubleshooting

### ArgoCD UI inacessível em localhost:30443

Verifique se o Kind mapeou as portas corretamente:

```bash
docker ps --filter name=argocdlab-control-plane --format "table {{.Ports}}"
```

Deve mostrar `0.0.0.0:30080->30080/tcp` e `0.0.0.0:30443->30443/tcp`.

### Pods em `ImagePullBackOff`

A imagem não foi encontrada no Docker Hub. Verifique:

```bash
kubectl describe pod -n argocdlab -l app=argocdlab-app
```

Causas comuns:
- Username do Docker Hub incorreto em `k8s/deployment.yaml`
- Build do GitHub Actions falhou — confira a aba Actions no GitHub
- Imagem é privada no Docker Hub — deixe pública nas configurações do repositório

### GitHub Actions falha no login do Docker Hub

- Verifique se os secrets `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` estão configurados
- O token deve ter permissões de **Read** e **Write** para repositórios

### ArgoCD travado em `Progressing`

```bash
kubectl describe application argocdlab-app -n argocd
kubectl get events -n argocdlab --sort-by=.lastTimestamp
```

### Contexto kubectl errado

```bash
kubectl config get-contexts
kubectl config use-context kind-argocdlab
```

---

## Estrutura do Repositório

```
argocdlab/
├── app/
│   ├── src/
│   │   └── index.js          # Express app: GET / e GET /health
│   ├── package.json
│   └── Dockerfile            # Multi-stage build, non-root user
├── k8s/
│   ├── kustomization.yaml     # Gerencia tag da imagem (atualizado pelo CI)
│   ├── namespace.yaml         # Namespace: argocdlab
│   ├── deployment.yaml        # 2 replicas, probes, resource limits
│   └── service.yaml           # NodePort 30081
├── argocd/
│   └── application.yaml       # ArgoCD Application (automated sync)
├── kind/
│   └── cluster-config.yaml    # Cluster com portMappings
├── .github/
│   └── workflows/
│       └── build-push.yml     # CI: build → scan Trivy → push → GitOps update
└── README.md
```
