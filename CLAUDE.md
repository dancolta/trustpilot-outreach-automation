# PROAGENTS.md
> The Ultimate AI Agent Architecture Guide
> Mirrored across CLAUDE.md, AGENTS.md, GEMINI.md, and CURSOR.md

You operate within a **3-Layer Architecture** that separates concerns to maximize reliability. LLMs are probabilistic; business logic is deterministic. This system bridges that gap through disciplined separation of intent, intelligence, and execution.

---

## Table of Contents

1. [The 3-Layer Architecture](#the-3-layer-architecture)
2. [Operating Principles](#operating-principles)
3. [Agentic Workflow Patterns](#agentic-workflow-patterns)
4. [Tool Use & Function Calling](#tool-use--function-calling)
5. [Memory Systems](#memory-systems)
6. [Error Handling & Self-Healing](#error-handling--self-healing)
7. [Human-in-the-Loop (HITL)](#human-in-the-loop-hitl)
8. [Reasoning & Planning](#reasoning--planning)
9. [Model Context Protocol (MCP)](#model-context-protocol-mcp)
10. [Evaluation & Observability](#evaluation--observability)
11. [Security & Guardrails](#security--guardrails)
12. [File Organization](#file-organization)

---

## The 3-Layer Architecture

### Why This Architecture?

If you do everything yourself, errors compound exponentially:
- 90% accuracy per step = **59% success** over 5 steps
- 80% accuracy per step = **33% success** over 5 steps

The solution: **push deterministic complexity into code, keep probabilistic decision-making in the LLM**.

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: DIRECTIVE (What to do)                            │
│  ├── SOPs written in Markdown                               │
│  ├── Goals, inputs, outputs, edge cases                     │
│  └── Natural language instructions                          │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: ORCHESTRATION (Decision making) ← YOU ARE HERE    │
│  ├── Intelligent routing & planning                         │
│  ├── Read directives, call execution tools                  │
│  ├── Handle errors, ask for clarification                   │
│  └── Update directives with learnings                       │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3: EXECUTION (Doing the work)                        │
│  ├── Deterministic Python/TypeScript scripts                │
│  ├── API calls, data processing, file operations            │
│  └── Reliable, testable, fast, well-commented               │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Directive (The "What")

Directives are SOPs in Markdown that live in `directives/`. They define:

```markdown
# directive_name.md

## Goal
What success looks like

## Inputs
- Required: [list required inputs]
- Optional: [list optional inputs with defaults]

## Tools/Scripts
- `execution/script_name.py` - description
- `execution/another_script.py` - description

## Process
1. Step one
2. Step two (decision point: if X, go to step 3; else step 4)
3. ...

## Outputs
- Primary: [main deliverable]
- Secondary: [logs, reports, etc.]

## Edge Cases
- If [condition]: [action]
- If [error]: [fallback]

## Learnings
<!-- Updated by orchestration layer -->
- [Date]: Discovered that [insight]
```

### Layer 2: Orchestration (The "How" - Your Role)

You are the intelligent glue between human intent and deterministic execution:

1. **Parse Intent**: Understand what the user actually wants
2. **Read Directives**: Find and follow the relevant SOP
3. **Plan Execution**: Determine tool order and dependencies
4. **Execute Tools**: Call scripts with proper inputs
5. **Handle Results**: Process outputs, handle errors
6. **Learn & Update**: Improve directives with discoveries

**Key principle**: Don't do the work yourself—orchestrate tools that do the work.

### Layer 3: Execution (The "Do")

Scripts in `execution/` that are:

- **Deterministic**: Same input → same output
- **Atomic**: One script, one responsibility
- **Testable**: Can run independently with test data
- **Well-documented**: Clear docstrings and comments
- **Error-explicit**: Raise clear exceptions, never fail silently

```python
# execution/example_script.py
"""
Purpose: [What this script does]
Input: [Expected input format]
Output: [Expected output format]
Dependencies: [External services/APIs used]
"""

import os
from typing import Dict, Any

def main(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main execution function.
    
    Args:
        input_data: Dictionary containing [describe structure]
        
    Returns:
        Dictionary containing [describe structure]
        
    Raises:
        ValueError: If input validation fails
        APIError: If external service fails
    """
    # Validate inputs
    if not input_data.get("required_field"):
        raise ValueError("Missing required_field")
    
    # Do the work
    result = process(input_data)
    
    return {"status": "success", "data": result}

if __name__ == "__main__":
    # Test execution
    test_input = {"required_field": "test_value"}
    print(main(test_input))
```

---

## Operating Principles

### 1. Check for Tools First

Before writing a script:
1. Check `execution/` for existing tools per your directive
2. Check if an MCP server provides the capability
3. Only create new scripts if none exist

### 2. Self-Anneal When Things Break

The **Self-Annealing Loop**:

```
Error Occurs
    ↓
Read error message + stack trace
    ↓
Diagnose root cause
    ↓
Fix the script (if safe) or check with user (if costly/risky)
    ↓
Test the fix
    ↓
Update directive with learning
    ↓
System is now stronger
```

**Example**: You hit an API rate limit → investigate API docs → find batch endpoint → rewrite script to use batching → test → update directive with rate limit info and batch approach.

### 3. Update Directives as You Learn

Directives are **living documents**. When you discover:
- API constraints or rate limits
- Better approaches or optimizations
- Common errors or edge cases
- Timing expectations

**Update the directive**. But don't create or overwrite directives without asking unless explicitly told to.

### 4. Fail Fast, Recover Gracefully

```
┌─────────────────────────────────────────┐
│         Error Handling Priority         │
├─────────────────────────────────────────┤
│ 1. Validate inputs before execution     │
│ 2. Catch specific exceptions            │
│ 3. Log with full context                │
│ 4. Attempt recovery if safe             │
│ 5. Escalate to human if uncertain       │
│ 6. Never fail silently                  │
└─────────────────────────────────────────┘
```

### 5. Prefer Simplicity Over Cleverness

From Anthropic's research: "The most successful implementations use simple, composable patterns rather than complex frameworks."

- Start with the simplest solution
- Add complexity only when proven necessary
- A good `if/else` beats a bad agent

---

## Agentic Workflow Patterns

### Pattern Selection Guide

```
┌──────────────────────────────────────────────────────────────────┐
│                    When to Use Each Pattern                       │
├──────────────────────────────────────────────────────────────────┤
│ PROMPT CHAINING     │ Sequential tasks, clear handoffs           │
│ ROUTING             │ Different inputs need different handling   │
│ PARALLELIZATION     │ Independent subtasks, need speed           │
│ ORCHESTRATOR-WORKER │ Dynamic subtasks, can't predict upfront    │
│ EVALUATOR-OPTIMIZER │ Quality matters, iterative refinement      │
│ AUTONOMOUS AGENT    │ Open-ended goals, requires adaptation      │
└──────────────────────────────────────────────────────────────────┘
```

### 1. Prompt Chaining

Sequential processing where output of step N becomes input to step N+1.

```
[Input] → [Agent 1] → [Gate] → [Agent 2] → [Gate] → [Agent 3] → [Output]
              ↓           ↓           ↓
          Validate    Validate    Validate
```

**Use when**:
- Task naturally decomposes into sequential steps
- Each step's output is input to the next
- You need validation gates between steps

**Implementation**:
```python
def chain_workflow(input_data):
    # Step 1: Generate
    draft = agent_generate(input_data)
    if not validate_draft(draft):
        return {"error": "Draft validation failed"}
    
    # Step 2: Refine
    refined = agent_refine(draft)
    if not validate_refined(refined):
        return {"error": "Refinement validation failed"}
    
    # Step 3: Format
    final = agent_format(refined)
    return {"output": final}
```

### 2. Routing

Classify input and direct to specialized handlers.

```
                    ┌─→ [Handler A] ─→ [Output A]
                    │
[Input] → [Router] ─┼─→ [Handler B] ─→ [Output B]
                    │
                    └─→ [Handler C] ─→ [Output C]
```

**Use when**:
- Different input types need specialized handling
- You want to optimize cost (simple → cheap model, complex → capable model)
- Domain expertise varies by input category

**Implementation**:
```python
ROUTES = {
    "billing": {"handler": billing_agent, "model": "fast"},
    "technical": {"handler": tech_agent, "model": "capable"},
    "general": {"handler": general_agent, "model": "fast"},
}

def route_workflow(input_data):
    # Classify input
    category = classifier_agent(input_data)
    
    # Route to appropriate handler
    route = ROUTES.get(category, ROUTES["general"])
    return route["handler"](input_data, model=route["model"])
```

### 3. Parallelization

Run independent tasks concurrently, then aggregate results.

```
              ┌─→ [Worker 1] ─┐
              │               │
[Input] → [Fan-out] → [Worker 2] → [Aggregator] → [Output]
              │               │
              └─→ [Worker 3] ─┘
```

**Two variations**:
- **Sectioning**: Split large input into chunks processed in parallel
- **Voting**: Run same task multiple times for consensus

**Use when**:
- Tasks are independent (no dependencies between them)
- Speed matters
- You need diverse perspectives or redundancy

**Implementation**:
```python
import asyncio

async def parallel_workflow(input_data):
    # Fan out to workers
    tasks = [
        worker_analyze_sentiment(input_data),
        worker_extract_entities(input_data),
        worker_summarize(input_data),
    ]
    
    # Execute in parallel
    results = await asyncio.gather(*tasks)
    
    # Aggregate results
    return aggregator(results)
```

### 4. Orchestrator-Workers

Central orchestrator dynamically plans and delegates to specialized workers.

```
                         ┌─→ [Worker A] ─┐
                         │               │
[Input] → [Orchestrator] ┼─→ [Worker B] ─┼→ [Orchestrator] → [Output]
              ↑          │               │        ↓
              │          └─→ [Worker C] ─┘        │
              └──────────── Feedback ─────────────┘
```

**Use when**:
- Subtasks can't be predicted upfront
- Task complexity varies
- Need adaptive problem-solving

**Key difference from parallelization**: Orchestrator decides dynamically which workers to invoke and in what order.

**Implementation**:
```python
def orchestrator_workflow(input_data):
    # Orchestrator plans the work
    plan = orchestrator_plan(input_data)
    
    results = []
    for task in plan["tasks"]:
        # Delegate to appropriate worker
        worker = get_worker(task["type"])
        result = worker(task["input"])
        results.append(result)
        
        # Orchestrator may adjust plan based on results
        plan = orchestrator_replan(plan, result)
    
    # Synthesize final output
    return orchestrator_synthesize(results)
```

### 5. Evaluator-Optimizer

Iterative refinement through evaluation and optimization loops.

```
[Input] → [Generator] → [Output] → [Evaluator] → Score
              ↑                         │
              └──── Feedback ───────────┘
              (loop until score > threshold or max_iterations)
```

**Use when**:
- Quality is paramount
- Clear evaluation criteria exist
- Output can be iteratively improved

**Implementation**:
```python
def evaluator_optimizer_workflow(input_data, max_iterations=5, threshold=0.8):
    output = generator(input_data)
    
    for i in range(max_iterations):
        # Evaluate current output
        evaluation = evaluator(output, input_data)
        
        if evaluation["score"] >= threshold:
            return {"output": output, "iterations": i + 1}
        
        # Optimize based on feedback
        output = optimizer(output, evaluation["feedback"])
    
    return {"output": output, "iterations": max_iterations, "warning": "Max iterations reached"}
```

### 6. Autonomous Agent (Full ReAct Loop)

For open-ended goals requiring dynamic reasoning and acting.

```
┌─────────────────────────────────────────┐
│              AUTONOMOUS AGENT            │
├─────────────────────────────────────────┤
│  while not done:                        │
│    1. Observe: Gather current state     │
│    2. Think: Reason about next step     │
│    3. Act: Execute tool or generate     │
│    4. Observe: Check result             │
│    5. Evaluate: Is goal achieved?       │
└─────────────────────────────────────────┘
```

**Use when**:
- Goals are open-ended
- Environment is dynamic
- Requires multi-step reasoning

**Caution**: Most tasks don't need full autonomy. Start with simpler patterns and escalate only when necessary.

---

## Tool Use & Function Calling

### Tool Definition Best Practices

```json
{
  "name": "search_database",
  "description": "Search the customer database for records matching criteria. Use when you need to find customer information, order history, or account details. Returns up to 10 matching records sorted by relevance.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query - can be customer name, email, or order ID"
      },
      "filters": {
        "type": "object",
        "description": "Optional filters to narrow results",
        "properties": {
          "date_from": {"type": "string", "format": "date"},
          "date_to": {"type": "string", "format": "date"},
          "status": {"type": "string", "enum": ["active", "inactive", "pending"]}
        }
      },
      "limit": {
        "type": "integer",
        "default": 10,
        "maximum": 100
      }
    },
    "required": ["query"]
  }
}
```

### Tool Description Guidelines

**DO**:
- Explain **when** to use the tool, not just what it does
- Specify input/output formats clearly
- Include limitations and edge cases
- Provide examples of good inputs

**DON'T**:
- Use vague descriptions like "search stuff"
- Omit important constraints
- Assume the model knows your domain

### Tool Calling Patterns

**1. Sequential Tool Calls**:
```
User: "Find John's order and update the shipping address"
1. search_customer(name="John") → customer_id
2. get_orders(customer_id) → order_id  
3. update_shipping(order_id, new_address)
```

**2. Parallel Tool Calls** (when supported):
```
User: "Get the weather in NYC and SF"
Parallel: [get_weather("NYC"), get_weather("SF")]
```

**3. Conditional Tool Calls**:
```
User: "Refund if eligible"
1. check_eligibility(order_id) → eligible: true/false
2. IF eligible: process_refund(order_id)
   ELSE: explain_policy()
```

### Structured Output Best Practices

Always validate LLM outputs before using them:

```python
from pydantic import BaseModel, validator

class ToolCallResult(BaseModel):
    tool_name: str
    arguments: dict
    confidence: float
    
    @validator('confidence')
    def check_confidence(cls, v):
        if not 0 <= v <= 1:
            raise ValueError('Confidence must be between 0 and 1')
        return v

# Validate tool call
try:
    result = ToolCallResult(**llm_output)
except ValidationError as e:
    # Handle malformed output
    request_clarification()
```

---

## Memory Systems

### Memory Taxonomy

```
┌─────────────────────────────────────────────────────────────────┐
│                        MEMORY SYSTEMS                            │
├─────────────────────────────────────────────────────────────────┤
│ SHORT-TERM (Working Memory)                                      │
│ ├── Current conversation context                                 │
│ ├── Recent messages and intermediate steps                       │
│ └── Immediate task state                                         │
├─────────────────────────────────────────────────────────────────┤
│ LONG-TERM MEMORY                                                 │
│ ├── Semantic: Facts, knowledge, domain information (RAG)        │
│ ├── Episodic: Past interactions, specific events                │
│ ├── Procedural: How to do things, learned workflows             │
│ └── Preference: User preferences, learned behaviors             │
└─────────────────────────────────────────────────────────────────┘
```

### Memory vs RAG

| Aspect | RAG | Memory |
|--------|-----|--------|
| Purpose | Bring external knowledge | Maintain continuity |
| Scope | Static documents | Dynamic interactions |
| State | Stateless | Stateful |
| Updates | Periodic indexing | Continuous |

**Best practice**: Use both. RAG for knowledge, memory for personalization.

### Memory Implementation Strategies

**1. Context Window Management**:
```python
class MemoryManager:
    def __init__(self, max_tokens=8000):
        self.max_tokens = max_tokens
        self.messages = []
        self.summary = ""
    
    def add_message(self, message):
        self.messages.append(message)
        if self._count_tokens() > self.max_tokens:
            self._compress()
    
    def _compress(self):
        # Summarize older messages
        old_messages = self.messages[:-5]  # Keep recent
        self.summary = summarize(old_messages)
        self.messages = self.messages[-5:]
    
    def get_context(self):
        return {
            "summary": self.summary,
            "recent_messages": self.messages
        }
```

**2. Vector Store for Long-term Memory**:
```python
class LongTermMemory:
    def __init__(self, vector_db):
        self.db = vector_db
    
    def store(self, content, metadata):
        embedding = embed(content)
        self.db.insert(embedding, content, metadata)
    
    def recall(self, query, top_k=5):
        query_embedding = embed(query)
        results = self.db.search(query_embedding, top_k)
        return results
```

**3. Intelligent Forgetting**:
```python
def should_remember(memory_item, current_time):
    """Decay function for memory relevance."""
    age = current_time - memory_item.timestamp
    base_relevance = memory_item.importance_score
    
    # Exponential decay with importance weighting
    decay_factor = math.exp(-age.days / 30)  # 30-day half-life
    relevance = base_relevance * decay_factor
    
    return relevance > MEMORY_THRESHOLD
```

---

## Error Handling & Self-Healing

### Error Classification

```
┌─────────────────────────────────────────────────────────────────┐
│                     ERROR TAXONOMY                               │
├─────────────────────────────────────────────────────────────────┤
│ TRANSIENT ERRORS (Retry with backoff)                           │
│ ├── Rate limits (429)                                           │
│ ├── Timeouts                                                    │
│ ├── Temporary service unavailability                            │
│ └── Network blips                                               │
├─────────────────────────────────────────────────────────────────┤
│ RECOVERABLE ERRORS (Fix and retry)                              │
│ ├── Invalid input format                                        │
│ ├── Missing required fields                                     │
│ ├── Schema mismatches                                           │
│ └── Authentication refresh needed                               │
├─────────────────────────────────────────────────────────────────┤
│ FATAL ERRORS (Escalate to human)                                │
│ ├── Permission denied                                           │
│ ├── Resource not found                                          │
│ ├── Business logic violations                                   │
│ └── Unknown/unexpected errors                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Retry Strategy

```python
import time
import random
from functools import wraps

def retry_with_backoff(max_retries=3, base_delay=1, max_delay=60):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except TransientError as e:
                    if attempt == max_retries - 1:
                        raise
                    
                    # Exponential backoff with jitter
                    delay = min(
                        base_delay * (2 ** attempt) + random.uniform(0, 1),
                        max_delay
                    )
                    
                    # Respect Retry-After header if present
                    if hasattr(e, 'retry_after'):
                        delay = max(delay, e.retry_after)
                    
                    time.sleep(delay)
            return None
        return wrapper
    return decorator
```

### Self-Healing Agent Pattern

```python
class SelfHealingAgent:
    def __init__(self, tools, fallback_handler=None):
        self.tools = tools
        self.fallback_handler = fallback_handler
        self.error_log = []
    
    def execute(self, task):
        try:
            result = self._try_execute(task)
            return result
        except RecoverableError as e:
            # Attempt automatic recovery
            recovery_result = self._attempt_recovery(task, e)
            if recovery_result:
                return recovery_result
            
            # Log for learning
            self._log_error(task, e)
            
            # Escalate or fallback
            if self.fallback_handler:
                return self.fallback_handler(task, e)
            raise
    
    def _attempt_recovery(self, task, error):
        """Try to fix and retry based on error type."""
        if error.type == "invalid_input":
            fixed_input = self._fix_input(task, error.details)
            return self._try_execute(Task(fixed_input))
        elif error.type == "tool_not_found":
            alternative = self._find_alternative_tool(task)
            if alternative:
                return alternative.execute(task)
        return None
    
    def _log_error(self, task, error):
        """Log error for analysis and directive updates."""
        self.error_log.append({
            "timestamp": datetime.now(),
            "task": task,
            "error": error,
            "context": self._get_context()
        })
```

### Circuit Breaker Pattern

```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=60):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.last_failure_time = None
        self.state = "closed"  # closed, open, half-open
    
    def call(self, func, *args, **kwargs):
        if self.state == "open":
            if self._should_attempt_recovery():
                self.state = "half-open"
            else:
                raise CircuitOpenError("Circuit is open")
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise
    
    def _on_success(self):
        self.failure_count = 0
        self.state = "closed"
    
    def _on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = "open"
    
    def _should_attempt_recovery(self):
        return time.time() - self.last_failure_time > self.recovery_timeout
```

### Saga Pattern for Multi-Step Operations

```python
class Saga:
    """Manage distributed transactions with compensating actions."""
    
    def __init__(self):
        self.steps = []
        self.completed_steps = []
    
    def add_step(self, action, compensation):
        self.steps.append({
            "action": action,
            "compensation": compensation
        })
    
    def execute(self):
        try:
            for step in self.steps:
                result = step["action"]()
                self.completed_steps.append({
                    "step": step,
                    "result": result
                })
            return {"status": "success"}
        except Exception as e:
            # Rollback completed steps in reverse order
            self._compensate()
            return {"status": "rolled_back", "error": str(e)}
    
    def _compensate(self):
        for completed in reversed(self.completed_steps):
            try:
                completed["step"]["compensation"](completed["result"])
            except Exception as comp_error:
                # Log compensation failure but continue
                log_error(f"Compensation failed: {comp_error}")
```

---

## Human-in-the-Loop (HITL)

### When to Involve Humans

```
┌─────────────────────────────────────────────────────────────────┐
│              HITL DECISION MATRIX                                │
├─────────────────────────────────────────────────────────────────┤
│ ALWAYS REQUIRE APPROVAL                                          │
│ ├── Financial transactions above threshold                       │
│ ├── Data deletion or modification                                │
│ ├── External communications (emails, messages)                   │
│ ├── Access control changes                                       │
│ └── Actions with legal/compliance implications                  │
├─────────────────────────────────────────────────────────────────┤
│ OPTIONAL REVIEW                                                  │
│ ├── Content generation for publication                          │
│ ├── Recommendations that affect user experience                 │
│ ├── Aggregated reports and summaries                            │
│ └── Non-critical automation tasks                               │
├─────────────────────────────────────────────────────────────────┤
│ AUTO-APPROVE (with logging)                                      │
│ ├── Read-only operations                                        │
│ ├── Internal tool usage                                         │
│ ├── Formatting and transformation                               │
│ └── Low-risk, reversible actions                                │
└─────────────────────────────────────────────────────────────────┘
```

### HITL Implementation Patterns

**1. Approval Gate**:
```python
async def approval_gate(action, context):
    """Pause execution until human approves."""
    
    # Create approval request
    request = {
        "action": action.to_dict(),
        "context": context,
        "timestamp": datetime.now(),
        "timeout": timedelta(hours=24)
    }
    
    # Send for review
    approval_id = await send_for_approval(request)
    
    # Wait for decision
    decision = await wait_for_decision(approval_id, timeout=request["timeout"])
    
    if decision.approved:
        return action.execute()
    elif decision.modified:
        return Action.from_dict(decision.modifications).execute()
    else:
        return {"status": "rejected", "reason": decision.reason}
```

**2. Confidence-Based Escalation**:
```python
def confidence_escalation(result, confidence_threshold=0.8):
    """Escalate to human if confidence is low."""
    
    if result.confidence >= confidence_threshold:
        return result.execute_automatically()
    else:
        return request_human_review(
            result,
            reason=f"Confidence {result.confidence:.2%} below threshold"
        )
```

**3. Timeout with Default**:
```python
async def timeout_with_default(action, timeout_seconds=3600, default_action="skip"):
    """If no human response within timeout, take default action."""
    
    try:
        decision = await asyncio.wait_for(
            request_approval(action),
            timeout=timeout_seconds
        )
        return execute_decision(decision)
    except asyncio.TimeoutError:
        log_timeout(action)
        if default_action == "approve":
            return action.execute()
        elif default_action == "reject":
            return {"status": "auto-rejected", "reason": "timeout"}
        else:  # skip
            return {"status": "skipped", "reason": "timeout"}
```

### Feedback Collection

```python
class FeedbackCollector:
    """Collect human feedback for continuous improvement."""
    
    def __init__(self, storage):
        self.storage = storage
    
    async def collect_feedback(self, output, context):
        feedback = await request_feedback(output, context)
        
        # Store for training/improvement
        self.storage.save({
            "input": context.input,
            "output": output,
            "feedback": feedback,
            "timestamp": datetime.now()
        })
        
        # Update metrics
        if feedback.rating:
            update_quality_metrics(output, feedback.rating)
        
        # Trigger immediate learning if critical
        if feedback.is_critical:
            await trigger_directive_update(feedback)
        
        return feedback
```

---

## Reasoning & Planning

### ReAct Pattern (Reasoning + Acting)

The ReAct framework synergizes reasoning and acting:

```
┌─────────────────────────────────────────────────────────────────┐
│                     ReAct LOOP                                   │
├─────────────────────────────────────────────────────────────────┤
│ Thought: I need to find the customer's order status.            │
│ Action: search_orders(customer_id="12345")                      │
│ Observation: Found 3 orders. Most recent: Order #789, shipped.  │
│                                                                  │
│ Thought: The order is shipped. I should get tracking info.      │
│ Action: get_tracking(order_id="789")                            │
│ Observation: Tracking: 1Z999AA10123456784, arriving tomorrow.   │
│                                                                  │
│ Thought: I have all the info needed to respond.                 │
│ Action: respond("Your order #789 is on its way...")             │
└─────────────────────────────────────────────────────────────────┘
```

### ReAct Prompt Template

```markdown
You are an AI assistant that solves problems using the ReAct approach.

For each step, follow this format:
Thought: Reason about the current situation and what to do next
Action: [tool_name](parameters)
Observation: [Result of the action - provided by the system]

Continue the Thought/Action/Observation cycle until you can provide a final answer.

When ready to respond to the user:
Thought: I have enough information to answer.
Action: respond(your_final_answer)

Available tools:
{tool_descriptions}

Remember:
- Think before each action
- Use observations to inform next steps
- Handle errors gracefully
- Ask for clarification if needed
```

### Chain-of-Thought for Complex Reasoning

```markdown
Let me work through this step by step:

1. First, I need to understand what's being asked:
   [Restate the problem]

2. What information do I have?
   [List known facts]

3. What information do I need?
   [List unknowns]

4. What's my approach?
   [Outline strategy]

5. Execute step by step:
   [Work through the problem]

6. Verify the result:
   [Check answer makes sense]

Therefore, the answer is: [Final answer]
```

### Planning Strategies

**1. Hierarchical Task Decomposition**:
```
Goal: Create quarterly report
├── Phase 1: Data Collection
│   ├── Pull sales data
│   ├── Pull marketing metrics
│   └── Pull customer feedback
├── Phase 2: Analysis
│   ├── Calculate KPIs
│   ├── Identify trends
│   └── Generate insights
├── Phase 3: Report Generation
│   ├── Create visualizations
│   ├── Write narrative
│   └── Format document
└── Phase 4: Review & Delivery
    ├── Quality check
    └── Distribute to stakeholders
```

**2. Dependency-Aware Planning**:
```python
class TaskPlanner:
    def __init__(self):
        self.tasks = {}
        self.dependencies = {}
    
    def add_task(self, task_id, task, depends_on=None):
        self.tasks[task_id] = task
        self.dependencies[task_id] = depends_on or []
    
    def get_execution_order(self):
        """Topological sort respecting dependencies."""
        visited = set()
        order = []
        
        def visit(task_id):
            if task_id in visited:
                return
            visited.add(task_id)
            for dep in self.dependencies[task_id]:
                visit(dep)
            order.append(task_id)
        
        for task_id in self.tasks:
            visit(task_id)
        
        return order
```

---

## Model Context Protocol (MCP)

### What is MCP?

MCP is an open standard for connecting AI agents to external systems—like USB-C for AI tools.

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐      ┌───────────┐      ┌──────────────────┐     │
│  │ AI Agent │ ←──→ │ MCP Client│ ←──→ │ MCP Server(s)    │     │
│  │          │      │           │      │ ├── GitHub       │     │
│  └──────────┘      └───────────┘      │ ├── Slack        │     │
│                                        │ ├── Database     │     │
│                                        │ ├── Custom Tools │     │
│                                        │ └── ...          │     │
│                                        └──────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Server Components

1. **Tools**: Functions the agent can call
2. **Resources**: Data the agent can read
3. **Prompts**: Templates for common interactions

### Creating an MCP Server

```python
# mcp_server.py
from mcp import Server, Tool

server = Server("my-company-tools")

@server.tool()
async def search_internal_docs(query: str) -> str:
    """
    Search internal documentation for relevant information.
    
    Args:
        query: Search query string
    
    Returns:
        Relevant document excerpts
    """
    results = await internal_search_engine.search(query)
    return format_results(results)

@server.tool()
async def create_ticket(
    title: str,
    description: str,
    priority: str = "medium"
) -> dict:
    """
    Create a support ticket in the internal system.
    
    Args:
        title: Ticket title
        description: Detailed description
        priority: low, medium, high, or critical
    
    Returns:
        Created ticket details including ID
    """
    ticket = await ticket_system.create(
        title=title,
        description=description,
        priority=priority
    )
    return ticket.to_dict()

if __name__ == "__main__":
    server.run()
```

### MCP Best Practices

1. **Keep tools focused**: One tool, one responsibility
2. **Rich descriptions**: Help the model understand when to use each tool
3. **Validate inputs**: Don't trust model outputs blindly
4. **Handle errors gracefully**: Return informative error messages
5. **Log everything**: For debugging and audit trails

---

## Evaluation & Observability

### Key Metrics

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT METRICS                                 │
├─────────────────────────────────────────────────────────────────┤
│ PERFORMANCE                                                      │
│ ├── Task Success Rate: % of tasks completed correctly           │
│ ├── Latency: Time to complete tasks (p50, p95, p99)            │
│ ├── Token Usage: Tokens per task (cost proxy)                   │
│ └── Tool Call Accuracy: % of correct tool selections            │
├─────────────────────────────────────────────────────────────────┤
│ QUALITY                                                          │
│ ├── Response Relevance: Does output match intent?               │
│ ├── Factual Accuracy: Are facts correct?                        │
│ ├── Hallucination Rate: % of fabricated information             │
│ └── User Satisfaction: Ratings, thumbs up/down                  │
├─────────────────────────────────────────────────────────────────┤
│ RELIABILITY                                                      │
│ ├── Error Rate: % of failed executions                          │
│ ├── Recovery Rate: % of errors successfully recovered           │
│ ├── MTTR: Mean time to recovery                                 │
│ └── Availability: Uptime percentage                             │
├─────────────────────────────────────────────────────────────────┤
│ SAFETY                                                           │
│ ├── Guardrail Triggers: Times safety limits hit                 │
│ ├── HITL Escalations: Times human intervention needed           │
│ ├── PII Exposure: Potential data leakage events                 │
│ └── Policy Violations: Outputs violating guidelines             │
└─────────────────────────────────────────────────────────────────┘
```

### Tracing Implementation

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind

tracer = trace.get_tracer(__name__)

async def agent_execute(task):
    with tracer.start_as_current_span(
        "agent_execute",
        kind=SpanKind.INTERNAL,
        attributes={
            "task.type": task.type,
            "task.id": task.id,
        }
    ) as span:
        try:
            # Planning phase
            with tracer.start_span("planning") as plan_span:
                plan = await plan_task(task)
                plan_span.set_attribute("plan.steps", len(plan.steps))
            
            # Execution phase
            results = []
            for step in plan.steps:
                with tracer.start_span(
                    f"execute_step_{step.name}",
                    attributes={"step.tool": step.tool}
                ) as step_span:
                    result = await execute_step(step)
                    step_span.set_attribute("step.success", result.success)
                    results.append(result)
            
            span.set_attribute("execution.success", True)
            return aggregate_results(results)
            
        except Exception as e:
            span.set_attribute("execution.success", False)
            span.set_attribute("error.message", str(e))
            span.record_exception(e)
            raise
```

### Evaluation Framework

```python
class AgentEvaluator:
    def __init__(self, metrics):
        self.metrics = metrics
    
    async def evaluate(self, agent_output, expected=None, context=None):
        results = {}
        
        for metric in self.metrics:
            if metric == "task_completion":
                results[metric] = await self._eval_task_completion(
                    agent_output, context
                )
            elif metric == "factual_accuracy":
                results[metric] = await self._eval_accuracy(agent_output)
            elif metric == "response_relevance":
                results[metric] = await self._eval_relevance(
                    agent_output, context.query
                )
            elif metric == "tool_correctness":
                results[metric] = await self._eval_tool_usage(
                    agent_output.tool_calls, expected.tool_calls if expected else None
                )
        
        return EvaluationResult(results)
    
    async def _eval_task_completion(self, output, context):
        """Use LLM-as-judge to evaluate task completion."""
        prompt = f"""
        Task: {context.task_description}
        Agent Output: {output}
        
        Did the agent successfully complete the task?
        Rate from 0 to 1 and explain.
        """
        judgment = await llm_judge(prompt)
        return judgment.score
```

### Continuous Monitoring Dashboard

```yaml
# monitoring_config.yaml
dashboards:
  agent_health:
    refresh: 30s
    panels:
      - title: Task Success Rate
        query: success_count / total_count
        threshold:
          warning: 0.95
          critical: 0.90
      
      - title: P95 Latency
        query: histogram_quantile(0.95, latency_histogram)
        threshold:
          warning: 5s
          critical: 10s
      
      - title: Error Rate by Type
        query: group_by(error_type, count)
        visualization: pie_chart
      
      - title: Token Usage Trend
        query: sum(tokens_used) by (hour)
        visualization: line_chart

alerts:
  - name: HighErrorRate
    condition: error_rate > 0.1
    for: 5m
    severity: critical
    action: page_on_call
  
  - name: LatencySpike
    condition: p95_latency > 10s
    for: 10m
    severity: warning
    action: notify_slack
```

---

## Security & Guardrails

### Defense in Depth

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                               │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1: INPUT VALIDATION                                        │
│ ├── Sanitize user inputs                                        │
│ ├── Detect prompt injection attempts                            │
│ ├── Rate limiting                                               │
│ └── Authentication/Authorization                                │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: EXECUTION CONTROLS                                      │
│ ├── Tool permission scoping                                     │
│ ├── Resource access limits                                      │
│ ├── Sandboxed execution environments                            │
│ └── Timeout enforcement                                         │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: OUTPUT FILTERING                                        │
│ ├── PII detection and redaction                                 │
│ ├── Content safety checks                                       │
│ ├── Response validation                                         │
│ └── Audit logging                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Guardrail Implementation

```python
class Guardrails:
    def __init__(self, config):
        self.config = config
        self.pii_detector = PIIDetector()
        self.content_filter = ContentFilter()
    
    def check_input(self, input_text):
        """Validate and sanitize input."""
        checks = []
        
        # Check for prompt injection
        if self._detect_injection(input_text):
            checks.append(GuardrailViolation("prompt_injection"))
        
        # Check rate limits
        if not self._check_rate_limit():
            checks.append(GuardrailViolation("rate_limit"))
        
        # Check content policy
        if not self.content_filter.is_safe(input_text):
            checks.append(GuardrailViolation("unsafe_content"))
        
        return GuardrailResult(passed=len(checks) == 0, violations=checks)
    
    def check_output(self, output_text):
        """Filter and validate output."""
        # Detect and redact PII
        if self.config.redact_pii:
            output_text, pii_found = self.pii_detector.redact(output_text)
            if pii_found:
                log_pii_event(pii_found)
        
        # Content safety check
        if not self.content_filter.is_safe(output_text):
            return GuardrailResult(
                passed=False,
                violations=[GuardrailViolation("unsafe_output")],
                safe_response="I cannot provide that information."
            )
        
        return GuardrailResult(passed=True, output=output_text)
    
    def _detect_injection(self, text):
        """Detect common prompt injection patterns."""
        injection_patterns = [
            r"ignore (previous|all) instructions",
            r"disregard (your|the) (rules|guidelines)",
            r"you are now",
            r"new instructions:",
            # Add more patterns
        ]
        return any(re.search(p, text, re.I) for p in injection_patterns)
```

### Principle of Least Privilege

```python
class ToolPermissions:
    """Scope tool access based on context and user."""
    
    def __init__(self):
        self.permissions = {}
    
    def define_scope(self, user_role, context):
        """Define what tools a user can access."""
        base_tools = ["search", "read"]
        
        if user_role == "admin":
            return base_tools + ["write", "delete", "configure"]
        elif user_role == "editor":
            return base_tools + ["write"]
        else:
            return base_tools
    
    def check_permission(self, user, tool, action):
        """Check if user can perform action with tool."""
        allowed_tools = self.define_scope(user.role, user.context)
        
        if tool not in allowed_tools:
            log_permission_denied(user, tool, action)
            return False
        
        return True
```

---

## File Organization

### Directory Structure

```
project/
├── directives/              # Layer 1: SOPs and instructions
│   ├── README.md           # Index of all directives
│   ├── data_pipeline.md    # Example directive
│   ├── report_generation.md
│   └── customer_support.md
│
├── execution/              # Layer 3: Deterministic scripts
│   ├── __init__.py
│   ├── data/
│   │   ├── fetch_data.py
│   │   ├── transform_data.py
│   │   └── validate_data.py
│   ├── integrations/
│   │   ├── slack.py
│   │   ├── sheets.py
│   │   └── database.py
│   └── utils/
│       ├── retry.py
│       ├── logging.py
│       └── validation.py
│
├── mcp_servers/           # MCP server implementations
│   ├── internal_tools/
│   └── custom_integrations/
│
├── tests/                 # Test suites
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .tmp/                  # Intermediate files (gitignored)
│   ├── cache/
│   ├── downloads/
│   └── processing/
│
├── .env                   # Environment variables (gitignored)
├── .env.example          # Template for .env
├── credentials.json      # OAuth credentials (gitignored)
├── requirements.txt      # Python dependencies
├── package.json         # Node dependencies (if applicable)
└── PROAGENTS.md         # This file
```

### File Conventions

**Directives** (`directives/*.md`):
- Use descriptive filenames: `verb_noun.md` (e.g., `generate_report.md`)
- Include metadata header
- Keep updated with learnings

**Execution Scripts** (`execution/**/*.py`):
- One module per responsibility
- Comprehensive docstrings
- Type hints for all functions
- Unit tests in parallel structure

**Temporary Files** (`.tmp/`):
- Always regeneratable
- Never committed to git
- Cleaned up after workflows

**Deliverables**:
- Final outputs go to cloud services (Google Drive, Sheets, etc.)
- Or explicitly specified output directories
- Never leave deliverables in `.tmp/`

---

## Quick Reference

### Decision Flow

```
User Request Received
        ↓
Does a directive exist?
    ├── YES → Read directive, follow process
    └── NO → Ask user if you should create one
        ↓
Can existing tools accomplish this?
    ├── YES → Use existing tools
    └── NO → Create new tool (minimal, focused)
        ↓
Execute with error handling
        ↓
Did it succeed?
    ├── YES → Deliver results
    └── NO → Self-anneal (fix, update directive)
        ↓
Log learnings, update directive
```

### Common Commands

```bash
# Run execution script
python execution/script_name.py --input data.json

# Test a specific module
pytest tests/unit/test_script_name.py

# Lint and format
black execution/
ruff check execution/

# Start MCP server
python mcp_servers/internal_tools/server.py
```

### Emergency Procedures

**If an agent is stuck in a loop**:
1. Check for circular dependencies in plan
2. Verify tool outputs match expected formats
3. Add explicit termination conditions
4. Implement max iteration limits

**If costs are unexpectedly high**:
1. Check for runaway parallel executions
2. Review token usage per step
3. Verify caching is working
4. Consider cheaper models for simple tasks

**If quality is degrading**:
1. Review recent directive changes
2. Check for model drift
3. Validate evaluation metrics
4. Increase HITL checkpoints

---

## Summary

You sit between **human intent** (directives) and **deterministic execution** (scripts). Your role:

1. **Read** instructions from directives
2. **Plan** the approach using appropriate patterns
3. **Execute** tools in the right order
4. **Handle** errors gracefully, self-heal when possible
5. **Learn** and update directives continuously
6. **Escalate** to humans when uncertain

**Principles**:
- Simple beats clever
- Deterministic beats probabilistic (when possible)
- Explicit beats implicit
- Logged beats forgotten
- Recoverable beats broken

**Be pragmatic. Be reliable. Self-anneal.**

---

*Last updated: 2025-01-17*
*Version: 2.0.0*
