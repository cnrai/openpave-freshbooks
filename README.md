# openpave-freshbooks

💰 Manage FreshBooks invoices, clients, expenses, payments, projects, and time tracking via secure API access.

## Installation

```bash
# From local directory
pave install ~/path/to/openpave-freshbooks

# From GitHub
pave install cnrai/openpave-freshbooks
```

## Setup

### 1. Get FreshBooks API Credentials

1. Log in to [FreshBooks](https://my.freshbooks.com)
2. Go to **Settings** → **Developer Portal** (or visit https://my.freshbooks.com/#/developer)
3. Create a new application
4. Note your **Client ID** and **Client Secret**
5. Set up a redirect URI (e.g., `http://localhost:3000/oauth/callback`)

### 2. Get a Refresh Token

Run the OAuth flow using the original FreshBooks CLI to get your refresh token:

```bash
# Using the C&R agent CLI
cd ~/git/cnr-agent
node src/cli/freshbooks.js auth
```

Follow the prompts to authorize and get your refresh token.

### 3. Configure the Token in PAVE

Add to `~/.pave/permissions.yaml` under the `tokens` section:

```yaml
tokens:
  freshbooks:
    env: FRESHBOOKS_ACCESS_TOKEN
    type: oauth
    domains:
      - api.freshbooks.com
    placement:
      type: header
      name: Authorization
      format: "Bearer {token}"
    refreshEnv: FRESHBOOKS_REFRESH_TOKEN
    refreshUrl: https://api.freshbooks.com/auth/oauth/token
    clientIdEnv: FRESHBOOKS_CLIENT_ID
    clientSecretEnv: FRESHBOOKS_CLIENT_SECRET
```

### 4. Set Environment Variables

Add to `~/.pave/tokens.yaml`:

```bash
FRESHBOOKS_REFRESH_TOKEN=your-refresh-token
FRESHBOOKS_CLIENT_ID=your-client-id
FRESHBOOKS_CLIENT_SECRET=your-client-secret
```

## Usage

### Account Info

```bash
# Get current user and business info
pave run freshbooks me --summary
```

### Clients

```bash
# List all clients
pave run freshbooks clients --summary

# Search clients by email
pave run freshbooks clients --search "acme" --summary

# Get specific client details
pave run freshbooks client 12345 --summary

# Create a new client
pave run freshbooks create-client --email "client@example.com" --org "Acme Inc" --fname "John" --lname "Doe"
```

### Invoices

```bash
# List all invoices
pave run freshbooks invoices --summary

# Filter by status (draft, sent, viewed, paid, partial, unpaid, overdue)
pave run freshbooks invoices --status paid --summary

# Filter by date range
pave run freshbooks invoices --from 2025-01-01 --to 2025-12-31 --summary

# Filter by client
pave run freshbooks invoices --client 12345 --summary

# Get specific invoice details
pave run freshbooks invoice 12345 --summary

# Create a new invoice (draft)
pave run freshbooks create-invoice --client 12345 --due 30 --notes "Payment due within 30 days"

# Send invoice by email
pave run freshbooks send-invoice 12345 --to "client@example.com" --subject "Invoice #123"
```

### Expenses

```bash
# List all expenses
pave run freshbooks expenses --summary

# Filter by date range
pave run freshbooks expenses --from 2025-01-01 --to 2025-12-31 --summary

# Filter by category
pave run freshbooks expenses --category 123 --summary

# Get specific expense details
pave run freshbooks expense 12345 --summary
```

### Payments

```bash
# List all payments
pave run freshbooks payments --summary

# Filter by invoice
pave run freshbooks payments --invoice 12345 --summary
```

### Categories

```bash
# List expense categories
pave run freshbooks categories --summary
```

### Projects

```bash
# List all projects
pave run freshbooks projects --summary
```

### Time Tracking

```bash
# List time entries
pave run freshbooks time --summary

# Filter by project
pave run freshbooks time --project 123 --summary

# Filter by date range
pave run freshbooks time --from 2025-01-01 --to 2025-01-31 --summary
```

### Reports

```bash
# Get profit/loss report
pave run freshbooks report --summary

# Get report for specific period
pave run freshbooks report --from 2025-01-01 --to 2025-12-31 --summary
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `me` | Get current user and account info |
| `clients` | List clients |
| `client <id>` | Get specific client details |
| `invoices` | List invoices |
| `invoice <id>` | Get specific invoice details |
| `expenses` | List expenses |
| `expense <id>` | Get specific expense details |
| `payments` | List payments |
| `categories` | List expense categories |
| `projects` | List projects |
| `time` | List time entries |
| `report` | Get profit/loss report |
| `create-client` | Create a new client |
| `create-invoice` | Create a new invoice |
| `send-invoice <id>` | Send an invoice by email |

## Invoice Status Values

| Status | Description |
|--------|-------------|
| `draft` | Invoice not yet sent |
| `sent` | Invoice sent to client |
| `viewed` | Client viewed the invoice |
| `paid` | Fully paid |
| `partial` | Partially paid |
| `unpaid` | Not paid |
| `overdue` | Past due date |

## Output Options

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON (default) |
| `--summary` | Human-readable summary format |

## Pagination Options

| Option | Description |
|--------|-------------|
| `-n, --count <number>` | Items per page (default: 25) |
| `-p, --page <number>` | Page number (default: 1) |

## Security

This skill uses the PAVE sandbox secure token system:
- OAuth tokens are **never exposed** to the skill code
- Network access is restricted to FreshBooks API domain only
- Automatic token refresh when expired
- No file system access required

## API Reference

- [FreshBooks API Documentation](https://www.freshbooks.com/api/start)

## License

MIT
