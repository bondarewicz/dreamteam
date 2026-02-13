# Example: User Authentication Feature

This example demonstrates the Dream Team workflow for implementing a new user authentication feature.

## Initial Request

**Business Goal**: Add secure user authentication to our web application

**Requirements**:
- Users can register with email and password
- Users can log in and log out
- Passwords must be securely hashed
- Session management with JWT tokens
- Must integrate with existing user database

---

## Phase 1: Domain Definition (Jordan)

**Input to Jordan**:
```yaml
business_goal: "Add secure user authentication"
user_requirements:
  - email/password registration
  - login/logout functionality
  - secure password storage
  - session management
existing_domain_model:
  - User entity exists
  - Database: PostgreSQL
```

**Jordan's Output**:
```yaml
domain_rules:
  - Email must be unique and validated
  - Password must meet minimum complexity (8+ chars, 1 number, 1 special char)
  - Authentication attempts must be rate-limited
  - Sessions expire after 24 hours of inactivity
  - Logout must invalidate all user sessions

acceptance_criteria:
  - User can register with valid email/password
  - User cannot register with duplicate email
  - User can log in with correct credentials
  - User cannot log in with incorrect credentials
  - User can log out and token is invalidated
  - Password is never stored in plaintext
  - Failed login attempts are limited (5 per hour)

business_invariants:
  - User identity must be verifiable
  - User data privacy must be maintained
  - Authentication state must be consistent
```

---

## Phase 2: Architecture Design (Bird)

**Input to Bird**: Jordan's output + existing system architecture

**Bird's Output**:
```yaml
architecture_proposal:
  components:
    - AuthService: handles registration, login, logout
    - PasswordHasher: bcrypt-based hashing (rounds=10)
    - TokenService: JWT generation and validation
    - RateLimiter: Redis-backed rate limiting
    - SessionStore: Redis for session management
  
  patterns:
    - Repository pattern for User data access
    - Service layer for business logic
    - Middleware for auth verification
    
  api_endpoints:
    - POST /auth/register
    - POST /auth/login
    - POST /auth/logout
    - GET /auth/me (verify current user)

key_trade_offs:
  - JWT vs Sessions: Using JWT for stateless scalability
  - Redis for rate limiting: Adds dependency but enables distributed rate limiting
  - bcrypt rounds=10: Balance between security and performance

flexibility_points:
  - Token service can be swapped (JWT → Paseto later)
  - Rate limiter implementation is abstracted
  - Password hashing algorithm is configurable

dependencies:
  - Redis (new): for sessions and rate limiting
  - bcrypt library: for password hashing
  - jsonwebtoken library: for JWT handling
```

---

## Phase 3: Task Breakdown (Coach K)

**Input to Coach K**: Jordan's criteria + Bird's architecture + timeline (1 week)

**Coach K's Output**:
```yaml
task_breakdown:
  increment_1_core_auth:
    - Setup auth database schema (User table updates)
    - Implement PasswordHasher service
    - Implement AuthService (register + login)
    - Add POST /auth/register endpoint
    - Add POST /auth/login endpoint
    - Write tests for registration and login
    priority: p0
    estimate: 2 days
    
  increment_2_session_management:
    - Setup Redis connection
    - Implement TokenService (JWT)
    - Implement SessionStore
    - Add POST /auth/logout endpoint
    - Add GET /auth/me endpoint
    - Add auth middleware
    - Write tests for session management
    priority: p0
    estimate: 2 days
    
  increment_3_security:
    - Implement RateLimiter service
    - Add rate limiting middleware
    - Add input validation
    - Security testing
    priority: p0
    estimate: 1 day
    
  increment_4_polish:
    - Error handling improvements
    - Logging and monitoring
    - Documentation
    priority: p1
    estimate: 1 day

sequence_order:
  1. increment_1_core_auth (ships first, gives basic auth)
  2. increment_2_session_management (adds logout/sessions)
  3. increment_3_security (hardens security)
  4. increment_4_polish (operational readiness)

scope_decisions:
  in_scope:
    - Email/password authentication
    - JWT-based sessions
    - Basic rate limiting
  deferred:
    - OAuth/social login (future)
    - Two-factor authentication (future)
    - Password reset flow (future)
  out_of_scope:
    - User profile management
    - Role-based access control

time_boxes:
  - Bird architecture review: 1 hour
  - Kobe security review: 30 min
  - Pippen ops review: 30 min
```

---

## Phase 4: Implementation (Shaq)

**Input to Shaq**: Coach K's tasks + Bird's architecture + Jordan's rules

**Shaq's Output** (Increment 1):
```typescript
// services/PasswordHasher.ts
import bcrypt from 'bcrypt';

export class PasswordHasher {
  private readonly saltRounds = 10;
  
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }
  
  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

// services/AuthService.ts
export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private passwordHasher: PasswordHasher
  ) {}
  
  async register(email: string, password: string): Promise<User> {
    // Validate email format
    if (!this.isValidEmail(email)) {
      throw new ValidationError('Invalid email format');
    }
    
    // Check for duplicate email
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictError('Email already registered');
    }
    
    // Validate password complexity
    if (!this.isValidPassword(password)) {
      throw new ValidationError(
        'Password must be 8+ chars with number and special char'
      );
    }
    
    // Hash password
    const passwordHash = await this.passwordHasher.hash(password);
    
    // Create user
    return this.userRepo.create({ email, passwordHash });
  }
  
  async login(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }
    
    const isValid = await this.passwordHasher.verify(
      password,
      user.passwordHash
    );
    
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }
    
    return user;
  }
  
  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  
  private isValidPassword(password: string): boolean {
    return (
      password.length >= 8 &&
      /\d/.test(password) &&
      /[!@#$%^&*]/.test(password)
    );
  }
}

// tests/AuthService.test.ts
describe('AuthService', () => {
  // ... comprehensive tests for registration and login
});
```

*(Full implementation abbreviated for example)*

---

## Phase 5: Quality Review (Kobe)

**Input to Kobe**: Shaq's implementation

**Kobe's Output**:
```yaml
critical_findings:
  1:
    title: "Timing Attack Vulnerability in Login"
    severity: CRITICAL
    description: |
      Current login implementation reveals whether email exists through
      timing differences. If email doesn't exist, fails fast. If exists,
      performs bcrypt comparison (slower).
    reproduction:
      - Time login attempts with non-existent emails (~1ms)
      - Time login attempts with wrong passwords (~100ms)
      - Attacker can enumerate valid emails
    proposed_fix: |
      Always perform bcrypt comparison, even for non-existent users:
      ```typescript
      const dummyHash = '$2b$10$...'; // pre-computed dummy hash
      const user = await this.userRepo.findByEmail(email);
      const hash = user?.passwordHash ?? dummyHash;
      const isValid = await this.passwordHasher.verify(password, hash);
      
      if (!user || !isValid) {
        throw new UnauthorizedError('Invalid credentials');
      }
      ```
    estimate: 30 minutes
    
  2:
    title: "Rate Limiting Not Yet Implemented"
    severity: HIGH
    description: |
      Registration and login endpoints have no rate limiting yet.
      Vulnerable to brute force attacks and automated account creation.
    reproduction:
      - Script 1000 registration attempts
      - Script brute force login attempts
    proposed_fix: |
      Increment 3 addresses this. Priority: must ship before production.
      Consider temporary IP-based limiting in load balancer.
    estimate: addressed in increment_3
    
  3:
    title: "Email Validation Regex Insufficient"
    severity: MEDIUM
    description: |
      Current regex allows some invalid email formats and is vulnerable
      to ReDoS with specially crafted strings.
    reproduction:
      - Email: "test@" (passes regex but invalid)
      - Email with 100+ @ symbols (ReDoS)
    proposed_fix: |
      Use established library like 'validator.js':
      ```typescript
      import validator from 'validator';
      
      private isValidEmail(email: string): boolean {
        return validator.isEmail(email, { allow_utf8_local_part: false });
      }
      ```
    estimate: 15 minutes
```

---

## Phase 6: Stability Review (Pippen)

**Input to Pippen**: Updated implementation (post-Kobe fixes)

**Pippen's Output**:
```yaml
integration_assessment:
  status: GOOD
  concerns:
    - Redis connection handling needs graceful degradation
    - Database transaction boundaries should be explicit
  recommendations:
    - Add circuit breaker for Redis
    - Use database transactions for user creation

observability_recommendations:
  logging:
    - Log all authentication attempts (success/failure) with IP
    - Log rate limit violations
    - Log password validation failures (without exposing password)
    - Use structured logging with request IDs
    
  metrics:
    - auth.registration.success (counter)
    - auth.registration.failure (counter, with reason label)
    - auth.login.success (counter)
    - auth.login.failure (counter, with reason label)
    - auth.login.duration (histogram)
    - auth.rate_limit.triggered (counter)
    
  tracing:
    - Span for each auth operation
    - Include user ID in successful operations

monitoring_requirements:
  health_checks:
    - GET /health/redis (check Redis connectivity)
    - GET /health/db (check database connectivity)
    
  alerts:
    - auth.login.failure rate > 10/min (potential attack)
    - auth.rate_limit.triggered rate > 50/min (DDoS)
    - Redis connection failures
    - auth.login.duration p99 > 500ms (performance)

operational_checklist:
  - ✓ Adequate error logging
  - ✓ Metrics for key operations
  - ✓ Health check endpoints needed
  - ✗ Graceful degradation strategy (Redis failure)
  - ✓ Timeout configurations
  - ✓ Retry logic (not needed for auth)
  - ✗ Deployment rollback plan needed
  - ✓ Configuration management (environment variables)
  - ✗ Documentation for on-call engineers needed

must_fix_before_ship:
  - Add Redis circuit breaker/fallback
  - Create operational runbook
  - Add health check endpoints
```

---

## Phase 7: Synthesis (Magic)

**Input to Magic**: All previous outputs

**Magic's Output**:
```markdown
# User Authentication Feature - Final Summary

## Current State
✅ Core authentication implemented (register, login)
✅ Critical security issues identified and fixed
⚠️ Operational readiness improvements needed before production

## Key Decisions Made

### ADR: JWT-Based Authentication
**Decision**: Use JWT tokens for session management instead of server-side sessions.

**Context**: Need scalable authentication across multiple app servers.

**Rationale**:
- Stateless: enables horizontal scaling
- Standard: well-supported libraries and tooling
- Flexible: can add claims as needed

**Trade-offs**:
- Cannot revoke tokens until expiry (mitigated by short expiry + refresh tokens)
- Slightly larger payload than session IDs

**Status**: Approved by Bird, accepted by Jordan, implemented by Shaq

### Security Hardening
**Kobe's Critical Findings Addressed**:
1. ✅ Timing attack vulnerability - FIXED with constant-time comparison
2. ⏳ Rate limiting - DEFERRED to Increment 3 (in progress)
3. ✅ Email validation - FIXED with validator.js library

### Operational Readiness
**Pippen's Requirements**:
- Redis circuit breaker implementation added
- Health check endpoints added
- Metrics and logging instrumented
- Operational runbook created

## Handoff Notes

### What's Shipping (Increment 1)
- User registration with email/password
- User login with JWT token generation
- Secure password hashing (bcrypt)
- Input validation
- Comprehensive test coverage

### Next Increment (Increment 2)
- Session management (logout, token refresh)
- Auth middleware for protected routes
- GET /auth/me endpoint

### Still To Do
- Rate limiting (Increment 3)
- Security testing (Increment 3)
- Final operational polish (Increment 4)

## Acceptance Criteria Status
- ✅ User can register with valid email/password
- ✅ User cannot register with duplicate email
- ✅ User can log in with correct credentials
- ✅ User cannot log in with incorrect credentials
- ⏳ User can log out and token is invalidated (Increment 2)
- ✅ Password is never stored in plaintext
- ⏳ Failed login attempts are limited (Increment 3)

## Timeline
- **Original estimate**: 1 week
- **Current status**: Day 2 (on track)
- **Increment 1 ETA**: End of Day 2
- **Full feature ETA**: Day 5 (buffer for security testing)

## Risks & Mitigations
- **Risk**: Rate limiting delayed to Increment 3
  - **Mitigation**: Temporary load balancer rate limiting
- **Risk**: Redis as new dependency
  - **Mitigation**: Circuit breaker + fallback strategy

## Coach K's Final Call
✅ **APPROVED TO SHIP** Increment 1 to staging
⏸️ **HOLD** for production until rate limiting complete

---
*Dream Team Session Complete*
*Next session: Increment 2 kickoff*
```

---

## Workflow Summary

This example demonstrates:
- **Jordan** defined business rules and acceptance criteria
- **Bird** designed the architecture with clear trade-offs
- **Coach K** broke work into shippable increments
- **Shaq** implemented according to spec
- **Kobe** found critical security issues (max 3)
- **Pippen** ensured operational readiness
- **Magic** synthesized everything into clear documentation

The team maintained productive tension:
- Kobe pushed for security vs Shaq's speed
- Coach K time-boxed reviews vs perfectionism
- Jordan's business correctness vs Bird's elegance

**Result**: High-quality, shippable software with clear traceability and documentation.
