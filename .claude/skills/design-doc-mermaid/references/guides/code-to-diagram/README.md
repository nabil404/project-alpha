# Code-to-Diagram Master Guide

**Version:** 1.0
**Last Updated:** 2025-01-13
**Purpose:** Comprehensive guide for extracting Mermaid diagrams from source code

This master guide explains how to analyze source code and configuration files to generate accurate Mermaid diagrams across different languages, frameworks, and architectural patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Analysis Workflow](#analysis-workflow)
3. [Framework-Specific Guides](#framework-specific-guides)
4. [Diagram Type Mapping](#diagram-type-mapping)
5. [Pattern Recognition](#pattern-recognition)
6. [Best Practices](#best-practices)
7. [Common Pitfalls](#common-pitfalls)

---

## Overview

**Code-to-diagram conversion** involves analyzing source code artifacts to extract architectural information and represent it visually using Mermaid diagrams.

### Why Convert Code to Diagrams?

- **Documentation Sync** - Diagrams stay current with code
- **Onboarding** - Visualize system structure for new team members
- **Code Review** - Understand architectural impact of changes
- **Refactoring** - Visualize current vs. desired architecture
- **Compliance** - Generate diagrams for audits and documentation requirements

### Supported Frameworks

| Framework      | Language              | Architecture Style                | Example Guide                                         |
| -------------- | --------------------- | --------------------------------- | ----------------------------------------------------- |
| **React**      | JavaScript/TypeScript | Component-based, state management | [React Guide](../../examples/react/README.md)         |
| **Express.js** | JavaScript/TypeScript | Middleware chain, routes          | [Node.js Guide](../../examples/node-webapp/README.md) |

---

## Analysis Workflow

Follow this systematic approach for any codebase:

### Step 1: Identify Framework and Patterns

**Scan for telltale signs:**

```bash
# Check project files
ls -la | grep -E "(pom.xml|build.gradle|package.json|requirements.txt|Pipfile)"

# Check for framework markers
grep -r "@SpringBootApplication\|@RestController" .
grep -r "from fastapi import\|@app.route" .
grep -r "express()\|app.use" .
```

**Common Framework Markers:**

| Framework   | File Markers                         | Code Markers                                            |
| ----------- | ------------------------------------ | ------------------------------------------------------- |
| Spring Boot | `pom.xml`, `build.gradle`            | `@SpringBootApplication`, `@RestController`, `@Service` |
| FastAPI     | `requirements.txt`, `pyproject.toml` | `from fastapi import`, `@app.get`, `async def`          |
| React       | `package.json`, `.jsx/.tsx` files    | `import React`, `useState`, `useEffect`                 |
| Express     | `package.json`, `app.js`             | `const express = require`, `app.use`, `app.get`         |
| Django      | `requirements.txt`, `settings.py`    | `from django`, `models.Model`, `views.py`               |

### Step 2: Map Code Structure to Diagram Types

| Code Artifact           | Extracts To              | Diagram Type | Guide                                                      |
| ----------------------- | ------------------------ | ------------ | ---------------------------------------------------------- |
| **Directory structure** | Package/module hierarchy | Architecture | [Architecture Guide](../diagrams/architecture-diagrams.md) |
| **Configuration files** | Infrastructure layout    | Deployment   | [Deployment Guide](../diagrams/deployment-diagrams.md)     |
| **Method calls**        | Request/response flow    | Sequence     | [Sequence Guide](../diagrams/sequence-diagrams.md)         |
| **Business logic**      | Process flow             | Activity     | [Activity Guide](../diagrams/activity-diagrams.md)         |
| **Database entities**   | Data relationships       | ER Diagram   | See examples                                               |

### Step 3: Extract Key Information

**For Architecture Diagrams:**

- Directory/package names → Components
- Import/dependency statements → Relationships
- Annotations/decorators → Component roles

**For Deployment Diagrams:**

- `application.yml`, `docker-compose.yml` → Services
- Port configurations → Network connections
- Environment variables → External dependencies

**For Sequence Diagrams:**

- Method signatures → Participants
- Method calls → Messages
- Return statements → Responses

**For Activity Diagrams:**

- Conditional statements (`if`, `switch`) → Decision nodes
- Loops (`for`, `while`) → Loop nodes
- Function calls → Activities

### Step 4: Apply Framework Patterns

Each framework has common architectural patterns. Load the appropriate framework guide:

```mermaid
graph TB
    Start([Analyze Codebase]) --> Detect{Detect Framework}

    Detect -->|Spring Boot| SpringGuide[Load Spring Boot Guide]
    Detect -->|FastAPI| FastAPIGuide[Load FastAPI Guide]
    Detect -->|React| ReactGuide[Load React Guide]
    Detect -->|Express| ExpressGuide[Load Express Guide]
    Detect -->|Java Servlet| ServletGuide[Load Servlet Guide]
    Detect -->|Python ETL| ETLGuide[Load ETL Guide]

    SpringGuide --> Extract[Extract Patterns]
    FastAPIGuide --> Extract
    ReactGuide --> Extract
    ExpressGuide --> Extract
    ServletGuide --> Extract
    ETLGuide --> Extract

    Extract --> Generate[Generate Mermaid Diagram]
    Generate --> Validate[Validate Syntax]
    Validate --> Done([Complete])

    classDef guide fill:#4ECDC4,stroke:#0B7285,color:#fff
    classDef process fill:#FFE66D,stroke:#F08C00,color:#000

    class SpringGuide,FastAPIGuide,ReactGuide,ExpressGuide,ServletGuide,ETLGuide guide
    class Extract,Generate,Validate process
```

### Step 5: Generate and Validate

1. **Generate Mermaid code** using patterns from guides
2. **Validate syntax** with `mmdc` (see SKILL.md, Validate)
3. **Review diagram** for accuracy and clarity
4. **Refine** based on team feedback

---

## Framework-Specific Guides

### React → Diagrams

**Key Patterns to Recognize:**

| React Pattern                          | Maps To          | Diagram      |
| -------------------------------------- | ---------------- | ------------ |
| Component hierarchy (imports)          | Component tree   | Architecture |
| `useState`, `useReducer`               | State management | Activity     |
| Redux `actions` → `reducers` → `store` | Data flow        | Sequence     |
| `useEffect` with async calls           | API interaction  | Sequence     |
| Route configuration                    | Navigation flow  | Architecture |

**Example Mapping:**

```javascript
// Source code
function ContactList() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const response = await api.get('/contacts');
      setContacts(response.data);
    } catch (error) {
      console.error('Failed to fetch contacts', error);
    } finally {
      setLoading(false);
    }
  };

  return <div>{loading ? <Spinner /> : <ContactTable contacts={contacts} />}</div>;
}
```

**Generated Sequence Diagram:**

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Component as ⚛️ ContactList
    participant API as 🌐 API Client
    participant Backend as ⚙️ Backend

    User->>Component: Navigate to page
    Component->>Component: useEffect fires
    Component->>Component: setLoading(true)
    Component->>+API: api.get('/contacts')
    API->>+Backend: GET /contacts
    Backend-->>-API: 200 OK + contacts[]
    API-->>-Component: response.data
    Component->>Component: setContacts(data)
    Component->>Component: setLoading(false)
    Component->>User: Render ContactTable
```

**Full Guide:** [React Examples](../../examples/react/README.md)

---

### Express.js → Diagrams

**Key Patterns to Recognize:**

| Express Pattern                            | Maps To              | Diagram      |
| ------------------------------------------ | -------------------- | ------------ |
| `app.use()` middleware chain               | Filter chain         | Activity     |
| Route handlers (`app.get()`, `app.post()`) | Endpoints            | Architecture |
| Controller → Service → Repository          | Layered architecture | Architecture |
| `next(err)` error handling                 | Error flow           | Sequence     |

**Example Mapping:**

```javascript
// Middleware chain
app.use(helmet()); // Security headers
app.use(cors()); // CORS
app.use(express.json()); // Body parsing
app.use(rateLimiter); // Rate limiting
app.use('/api', authMiddleware); // Authentication

// Route handler
router.post('/contacts', async (req, res, next) => {
  try {
    const contact = await contactService.create(req.body);
    res.status(201).json(contact);
  } catch (error) {
    next(error);
  }
});
```

**Generated Activity Diagram:**

```mermaid
flowchart TD
    Start([HTTP Request]) --> Helmet[🛡️ Helmet Middleware<br/>Add security headers]
    Helmet --> CORS[🌐 CORS Middleware<br/>Check origin]
    CORS --> BodyParser[📋 Body Parser<br/>Parse JSON]
    BodyParser --> RateLimit{⏱️ Rate Limiter<br/>Check limit}

    RateLimit -->|Exceeded| Return429[❌ 429 Too Many Requests]
    RateLimit -->|OK| Auth{🔐 Auth Middleware<br/>Token valid?}

    Auth -->|Invalid| Return401[❌ 401 Unauthorized]
    Auth -->|Valid| RouteHandler[📝 Route Handler<br/>POST /contacts]

    RouteHandler --> Service[⚙️ Contact Service<br/>create(data)]
    Service --> Success[✅ 201 Created]

    Return429 --> End([Response])
    Return401 --> End
    Success --> End
```

**Full Guide:** [Node.js/Express Examples](../../examples/node-webapp/README.md)

---

## Diagram Type Mapping

### Quick Reference Table

| If Code Contains...                   | Generate...               | Use Guide...                                         |
| ------------------------------------- | ------------------------- | ---------------------------------------------------- |
| Package/directory structure           | Architecture diagram      | [Architecture](../diagrams/architecture-diagrams.md) |
| Configuration files (YAML, XML, JSON) | Deployment diagram        | [Deployment](../diagrams/deployment-diagrams.md)     |
| Method calls between classes          | Sequence diagram          | [Sequence](../diagrams/sequence-diagrams.md)         |
| Conditional logic, loops              | Activity diagram          | [Activity](../diagrams/activity-diagrams.md)         |
| Database entity annotations           | ER diagram                | See framework examples                               |
| Message queue publishers/consumers    | Event-driven architecture | [Architecture](../diagrams/architecture-diagrams.md) |

### Decision Tree

```mermaid
graph TD
    Start([Code Artifact]) --> Type{What Are You<br/>Analyzing?}

    Type -->|Directory<br/>structure| Arch[Generate<br/>Architecture Diagram]
    Type -->|Config files<br/>YAML, Dockerfile| Deploy[Generate<br/>Deployment Diagram]
    Type -->|Method with<br/>API calls| Seq[Generate<br/>Sequence Diagram]
    Type -->|Business logic<br/>with conditions| Act[Generate<br/>Activity Diagram]
    Type -->|Database<br/>entities| ER[Generate<br/>ER Diagram]

    Arch --> LoadArch[Load Architecture Guide]
    Deploy --> LoadDeploy[Load Deployment Guide]
    Seq --> LoadSeq[Load Sequence Guide]
    Act --> LoadAct[Load Activity Guide]
    ER --> LoadFramework[Load Framework Example]

    classDef decision fill:#FFE66D,stroke:#F08C00,color:#000
    classDef diagram fill:#4ECDC4,stroke:#0B7285,color:#fff
    classDef guide fill:#95E1D3,stroke:#087F5B,color:#000

    class Type decision
    class Arch,Deploy,Seq,Act,ER diagram
    class LoadArch,LoadDeploy,LoadSeq,LoadAct,LoadFramework guide
```

---

## Pattern Recognition

### Common Architectural Patterns

#### 1. Layered Architecture (MVC)

**Code Indicators:**

- Directories: `controllers/`, `services/`, `repositories/` or `dao/`
- Clear separation between presentation, business, and data layers

**Diagram Type:** Architecture (layered)

**Template:**

```mermaid
graph TB
    subgraph "Presentation Layer"
        Controllers[Controllers/Routes]
    end

    subgraph "Business Logic Layer"
        Services[Services]
    end

    subgraph "Data Access Layer"
        Repositories[Repositories/DAOs]
    end

    Database[(Database)]

    Controllers --> Services
    Services --> Repositories
    Repositories --> Database
```

#### 2. Microservices

**Code Indicators:**

- Multiple independent `main()` or entry points
- Service discovery configuration (Consul, Eureka)
- Inter-service HTTP clients or message queue publishers/consumers

**Diagram Type:** Architecture (microservices)

**Template:** See [Architecture Guide - Microservices Section](../diagrams/architecture-diagrams.md#microservices-architecture)

#### 3. Event-Driven

**Code Indicators:**

- Message queue consumers/producers (Kafka, RabbitMQ, SQS)
- Event handler methods (`@EventListener`, `@Subscribe`)
- Async message processing

**Diagram Type:** Activity (event flow) or Architecture (event-driven)

**Template:** See [Architecture Guide - Event-Driven Section](../diagrams/architecture-diagrams.md#event-driven-architecture)

#### 4. CQRS (Command Query Responsibility Segregation)

**Code Indicators:**

- Separate read and write models
- Command handlers and query handlers
- Event sourcing (event store)

**Diagram Type:** Architecture (CQRS) with multiple data stores

**Template:** See [Architecture Guide - CQRS Section](../diagrams/architecture-diagrams.md#pattern---event-sourcing-with-cqrs)

---

## Best Practices

### 1. **Start High-Level, Then Zoom In**

Don't try to diagram everything at once:

1. **First:** System context (C4 Level 1)
2. **Then:** Container diagram (C4 Level 2)
3. **Then:** Component diagram for key containers
4. **Finally:** Sequence diagrams for critical flows

### 2. **Use Framework Examples as Templates**

Don't reinvent patterns. If you're analyzing an Express-style API or a React app:

1. Load [Node.js Guide](../../examples/node-webapp/README.md) or [React Guide](../../examples/react/README.md)
2. Find similar code patterns
3. Adapt the Mermaid template to your specific code

### 3. **Include Technology Stack**

Always label:

- Programming language & version
- Framework & version
- Database technology
- Communication protocols
- Port numbers

### 4. **Validate Diagram Syntax**

```bash
# Render every mermaid fence; exits 1 on a parse error
npx -y -p @mermaid-js/mermaid-cli mmdc -i docs/architecture.md -o "$TMPDIR/out.md"
```

### 5. **Keep Diagrams Current**

- Update diagrams when code changes
- Store diagrams in version control alongside code
- Add diagram generation to CI/CD pipeline (optional)

### 6. **Use Semantic Unicode Symbols**

Refer to [Unicode Symbols Guide](../unicode-symbols/guide.md) for:

- 👤 Users/actors
- ⚙️ Services
- 💾 Databases
- 🔐 Security components
- 📬 Message queues

### 7. **Document Diagram Scope**

Add a note to clarify what the diagram shows:

```mermaid
graph TB
    Note[📝 Scope: User authentication flow<br/>Excludes: Password reset, 2FA]

    style Note fill:#FFF9C4,stroke:#F9A825,color:#000
```

---

## Common Pitfalls

### ❌ Pitfall 1: Mixing Abstraction Levels

**Bad:**

```mermaid
graph TB
    UserService --> Database
    UserService --> UserRepository.findById
```

❌ Mixing component (UserService) with method call (findById)

**Good:**

```mermaid
graph TB
    UserService --> UserRepository
    UserRepository --> Database
```

✅ Consistent abstraction level (components)

### ❌ Pitfall 2: Overloading Diagrams

**Bad:** One diagram showing 20+ components

**Good:** Multiple focused diagrams:

- Architecture diagram (10-12 components)
- Separate sequence diagram for each key flow

### ❌ Pitfall 3: Missing Communication Protocols

**Bad:**

```mermaid
graph TB
    ServiceA --> ServiceB
```

❌ How do they communicate?

**Good:**

```mermaid
graph TB
    ServiceA -->|REST API<br/>HTTPS<br/>JSON| ServiceB
```

✅ Protocol specified

### ❌ Pitfall 4: Ignoring Error Paths

**Bad:** Only showing happy path

**Good:** Create separate diagrams for:

- Main success flow
- Validation errors
- System errors
- Timeout/retry scenarios

### ❌ Pitfall 5: Outdated Diagrams

**Bad:** Diagram created once, never updated

**Good:**

- Store diagrams with code (e.g., `docs/diagrams/`)
- Update during code reviews
- Validate with team during architecture reviews

---

## Summary Workflow

```mermaid
flowchart TD
    Start([Receive Codebase]) --> Identify[🔍 Identify Framework<br/>Check files, imports, annotations]

    Identify --> LoadGuide[📚 Load Framework-Specific Guide<br/>Spring Boot, FastAPI, React, etc.]

    LoadGuide --> Analyze[🧩 Analyze Code Structure<br/>Directories, configs, dependencies]

    Analyze --> SelectDiagram{📊 Select Diagram Type}

    SelectDiagram -->|Structure| ArchDiagram[🏗️ Architecture Diagram]
    SelectDiagram -->|Config| DeployDiagram[☁️ Deployment Diagram]
    SelectDiagram -->|Methods| SeqDiagram[📨 Sequence Diagram]
    SelectDiagram -->|Logic| ActDiagram[⚡ Activity Diagram]

    ArchDiagram --> Generate[✏️ Generate Mermaid Code]
    DeployDiagram --> Generate
    SeqDiagram --> Generate
    ActDiagram --> Generate

    Generate --> Validate[✅ Validate Syntax<br/>mmdc]

    Validate --> Valid{Valid?}
    Valid -->|No| Fix[🔧 Fix Syntax Errors]
    Fix --> Validate

    Valid -->|Yes| Review[👥 Team Review]

    Review --> Approved{Approved?}
    Approved -->|No| Refine[📝 Refine Diagram]
    Refine --> Generate

    Approved -->|Yes| Document[📄 Add to Documentation]
    Document --> Done([✅ Complete])

    classDef process fill:#4ECDC4,stroke:#0B7285,color:#fff
    classDef decision fill:#FFE66D,stroke:#F08C00,color:#000
    classDef diagram fill:#95E1D3,stroke:#087F5B,color:#000
    classDef done fill:#A8DADC,stroke:#1864AB,color:#000

    class Identify,LoadGuide,Analyze,Generate,Validate,Review,Document process
    class SelectDiagram,Valid,Approved decision
    class ArchDiagram,DeployDiagram,SeqDiagram,ActDiagram diagram
    class Done done
```

---

## Quick Start Checklist

- [ ] **Step 1:** Identify framework (Spring Boot, FastAPI, React, etc.)
- [ ] **Step 2:** Load appropriate framework example guide
- [ ] **Step 3:** Decide which diagram type(s) to create
- [ ] **Step 4:** Extract relevant code patterns
- [ ] **Step 5:** Generate Mermaid diagram using guide templates
- [ ] **Step 6:** Add Unicode symbols for clarity
- [ ] **Step 7:** Apply high-contrast styling
- [ ] **Step 8:** Validate syntax with validation script
- [ ] **Step 9:** Review with team
- [ ] **Step 10:** Commit to version control with code

---

**Related Resources:**

- [Activity Diagrams Guide](../diagrams/activity-diagrams.md)
- [Architecture Diagrams Guide](../diagrams/architecture-diagrams.md)
- [Deployment Diagrams Guide](../diagrams/deployment-diagrams.md)
- [Sequence Diagrams Guide](../diagrams/sequence-diagrams.md)
- [Unicode Symbols Reference](../unicode-symbols/guide.md)
- [React Examples](../../examples/react/README.md)
- [Node.js Examples](../../examples/node-webapp/README.md)

---

**Version:** 1.0
**Last Updated:** 2025-01-13
**Token Count:** ~7,000 words
