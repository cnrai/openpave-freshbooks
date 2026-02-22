#!/usr/bin/env node
/**
 * FreshBooks CLI - Secure Token Version
 * 
 * Uses the PAVE sandbox secure token system for authentication.
 * Tokens are never visible to sandbox code - they're injected by the host.
 * 
 * Token configuration in ~/.pave/permissions.yaml:
 * {
 *   "tokens": {
 *     "freshbooks": {
 *       "env": "FRESHBOOKS_ACCESS_TOKEN",
 *       "type": "oauth",
 *       "domains": ["api.freshbooks.com"],
 *       "placement": {
 *         "type": "header",
 *         "name": "Authorization",
 *         "format": "Bearer {token}"
 *       },
 *       "refreshEnv": "FRESHBOOKS_REFRESH_TOKEN",
 *       "refreshUrl": "https://api.freshbooks.com/auth/oauth/token",
 *       "clientIdEnv": "FRESHBOOKS_CLIENT_ID",
 *       "clientSecretEnv": "FRESHBOOKS_CLIENT_SECRET"
 *     }
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments  
const args = process.argv.slice(2);

function parseArgs() {
  const parsed = {
    command: null,
    positional: [],
    options: {}
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=', 2);
        if (value !== undefined) {
          parsed.options[key] = value;
        } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          parsed.options[key] = args[i + 1];
          i++;
        } else {
          parsed.options[key] = true;
        }
      } else {
        const flag = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          parsed.options[flag] = args[i + 1];
          i++;
        } else {
          parsed.options[flag] = true;
        }
      }
    } else {
      if (parsed.command === null) {
        parsed.command = arg;
      } else {
        parsed.positional.push(arg);
      }
    }
  }
  
  return parsed;
}

// URL encoding function for sandbox compatibility
function encodeFormData(data) {
  const params = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return params.join('&');
}

// Format currency
function formatCurrency(amount, code) {
  code = code || 'USD';
  const num = parseFloat(amount) || 0;
  return code + ' ' + num.toFixed(2);
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  } catch (e) {
    return dateStr;
  }
}

// FreshBooks Client Class - Uses secure token system
class FreshBooksClient {
  constructor() {
    // Check if freshbooks token is available via secure token system
    if (typeof hasToken === 'function' && !hasToken('freshbooks')) {
      console.error('FreshBooks token not configured.');
      console.error('');
      console.error('Add to ~/.pave/permissions.yaml under tokens section:');
      console.error('');
      console.error('  freshbooks:');
      console.error('    env: FRESHBOOKS_ACCESS_TOKEN');
      console.error('    type: oauth');
      console.error('    domains:');
      console.error('      - api.freshbooks.com');
      console.error('    placement:');
      console.error('      type: header');
      console.error('      name: Authorization');
      console.error('      format: "Bearer {token}"');
      console.error('    refreshEnv: FRESHBOOKS_REFRESH_TOKEN');
      console.error('    refreshUrl: https://api.freshbooks.com/auth/oauth/token');
      console.error('    clientIdEnv: FRESHBOOKS_CLIENT_ID');
      console.error('    clientSecretEnv: FRESHBOOKS_CLIENT_SECRET');
      console.error('');
      console.error('Then set environment variables in ~/.pave/tokens.yaml:');
      console.error('  FRESHBOOKS_REFRESH_TOKEN=your-refresh-token');
      console.error('  FRESHBOOKS_CLIENT_ID=your-client-id');
      console.error('  FRESHBOOKS_CLIENT_SECRET=your-client-secret');
      console.error('');
      console.error('Get credentials from: https://my.freshbooks.com/#/developer');
      throw new Error('FreshBooks token not configured');
    }
    
    this.baseUrl = 'https://api.freshbooks.com';
    this.accountId = null;
    this.businessId = null;
  }
  
  request(endpoint, options) {
    options = options || {};
    const url = endpoint.startsWith('http') ? endpoint : this.baseUrl + endpoint;
    
    // Use authenticatedFetch - token injection handled by sandbox
    var fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Api-Version': 'alpha'
      },
      timeout: options.timeout || 15000
    };
    
    if (options.body) {
      fetchOptions.body = options.body;
    }
    
    var response = authenticatedFetch('freshbooks', url, fetchOptions);
    
    if (!response.ok) {
      var error;
      try {
        error = response.json();
      } catch (e) {
        error = { message: 'HTTP ' + response.status };
      }
      var errorMsg = (error.response && error.response.errors && error.response.errors[0] && error.response.errors[0].message) ||
                     error.error_description || 
                     error.error || 
                     error.message ||
                     'API request failed: ' + response.status;
      var err = new Error(errorMsg);
      err.status = response.status;
      err.data = error;
      throw err;
    }
    
    return response.json();
  }
  
  getMe() {
    var data = this.request('/auth/api/v1/users/me');
    
    // Cache account and business IDs for later use
    if (data.response && data.response.business_memberships && data.response.business_memberships.length > 0) {
      var membership = data.response.business_memberships[0];
      this.accountId = membership.business.account_id;
      this.businessId = membership.business.id;
    }
    
    return data.response;
  }
  
  ensureAccountId() {
    if (!this.accountId) {
      this.getMe();
    }
    if (!this.accountId) {
      throw new Error('Could not determine FreshBooks account ID');
    }
  }
  
  listClients(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = {};
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;
    if (options.search) params['search[email_like]'] = options.search;
    
    var query = encodeFormData(params);
    var endpoint = '/accounting/account/' + this.accountId + '/users/clients' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
  
  getClient(clientId) {
    this.ensureAccountId();
    return this.request('/accounting/account/' + this.accountId + '/users/clients/' + clientId);
  }
  
  createClient(clientData) {
    this.ensureAccountId();
    return this.request('/accounting/account/' + this.accountId + '/users/clients', {
      method: 'POST',
      body: JSON.stringify({ client: clientData })
    });
  }
  
  listInvoices(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = { 'include[]': 'lines' };
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;
    if (options.status) params['search[status]'] = options.status;
    if (options.clientId) params['search[customerid]'] = options.clientId;
    if (options.dateMin) params['search[date_min]'] = options.dateMin;
    if (options.dateMax) params['search[date_max]'] = options.dateMax;
    
    var query = encodeFormData(params);
    var endpoint = '/accounting/account/' + this.accountId + '/invoices/invoices' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
  
  getInvoice(invoiceId) {
    this.ensureAccountId();
    return this.request('/accounting/account/' + this.accountId + '/invoices/invoices/' + invoiceId + '?include[]=lines');
  }
  
  createInvoice(invoiceData) {
    this.ensureAccountId();
    return this.request('/accounting/account/' + this.accountId + '/invoices/invoices', {
      method: 'POST',
      body: JSON.stringify({ invoice: invoiceData })
    });
  }
  
  sendInvoice(invoiceId, options) {
    options = options || {};
    this.ensureAccountId();
    
    var emailData = {
      invoice_id: invoiceId,
      action_email: true
    };
    
    if (options.recipients) emailData.email_recipients = options.recipients;
    if (options.subject) emailData.email_subject = options.subject;
    if (options.body) emailData.email_body = options.body;
    
    return this.request('/accounting/account/' + this.accountId + '/invoices/invoices/' + invoiceId, {
      method: 'PUT',
      body: JSON.stringify({ invoice: emailData })
    });
  }
  
  listExpenses(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = {};
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;
    if (options.dateMin) params['search[date_min]'] = options.dateMin;
    if (options.dateMax) params['search[date_max]'] = options.dateMax;
    if (options.categoryId) params['search[categoryid]'] = options.categoryId;
    
    var query = encodeFormData(params);
    var endpoint = '/accounting/account/' + this.accountId + '/expenses/expenses' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
  
  getExpense(expenseId) {
    this.ensureAccountId();
    return this.request('/accounting/account/' + this.accountId + '/expenses/expenses/' + expenseId);
  }
  
  listPayments(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = {};
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;
    if (options.invoiceId) params['search[invoiceid]'] = options.invoiceId;
    
    var query = encodeFormData(params);
    var endpoint = '/accounting/account/' + this.accountId + '/payments/payments' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
  
  listCategories() {
    this.ensureAccountId();
    return this.request('/accounting/account/' + this.accountId + '/expenses/categories');
  }
  
  listProjects(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = {};
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;
    
    var query = encodeFormData(params);
    var endpoint = '/projects/business/' + this.businessId + '/projects' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
  
  listTimeEntries(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = {};
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = options.perPage;
    if (options.projectId) params.project_id = options.projectId;
    if (options.startedFrom) params.started_from = options.startedFrom;
    if (options.startedTo) params.started_to = options.startedTo;
    
    var query = encodeFormData(params);
    var endpoint = '/timetracking/business/' + this.businessId + '/time_entries' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
  
  getProfitLossReport(options) {
    options = options || {};
    this.ensureAccountId();
    
    var params = {};
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    
    var query = encodeFormData(params);
    var endpoint = '/accounting/account/' + this.accountId + '/reports/accounting/profitloss' + (query ? '?' + query : '');
    return this.request(endpoint);
  }
}

function printHelp() {
  console.log('');
  console.log('FreshBooks CLI - Secure Token Version');
  console.log('');
  console.log('USAGE:');
  console.log('  freshbooks <command> [options]');
  console.log('');
  console.log('COMMANDS:');
  console.log('  me                          Get current user and account info');
  console.log('  clients                     List clients');
  console.log('  client <clientId>           Get a specific client');
  console.log('  invoices                    List invoices');
  console.log('  invoice <invoiceId>         Get a specific invoice');
  console.log('  expenses                    List expenses');
  console.log('  expense <expenseId>         Get a specific expense');
  console.log('  payments                    List payments');
  console.log('  categories                  List expense categories');
  console.log('  projects                    List projects');
  console.log('  time                        List time entries');
  console.log('  report                      Get profit/loss report');
  console.log('  create-client               Create a new client');
  console.log('  create-invoice              Create a new invoice');
  console.log('  send-invoice <invoiceId>    Send an invoice by email');
  console.log('');
  console.log('LIST OPTIONS:');
  console.log('  -n, --count <count>         Number of items per page (default: 25)');
  console.log('  -p, --page <page>           Page number (default: 1)');
  console.log('  -s, --search <query>        Search query (for clients)');
  console.log('  -c, --client <clientId>     Filter by client ID (for invoices)');
  console.log('  --status <status>           Filter by status (draft, sent, paid, etc.)');
  console.log('  --from <date>               Filter by date (from) YYYY-MM-DD');
  console.log('  --to <date>                 Filter by date (to) YYYY-MM-DD');
  console.log('  --category <id>             Filter by category ID (for expenses)');
  console.log('  --project <id>              Filter by project ID (for time entries)');
  console.log('');
  console.log('CREATE CLIENT OPTIONS:');
  console.log('  --email <email>             Client email (required)');
  console.log('  --fname <name>              First name');
  console.log('  --lname <name>              Last name');
  console.log('  --org <name>                Organization/company name');
  console.log('  --phone <phone>             Phone number');
  console.log('');
  console.log('CREATE INVOICE OPTIONS:');
  console.log('  -c, --client <clientId>     Client ID (required)');
  console.log('  --due <days>                Due in days (default: 30)');
  console.log('  --notes <notes>             Invoice notes');
  console.log('');
  console.log('SEND INVOICE OPTIONS:');
  console.log('  --to <emails>               Recipient emails (comma-separated)');
  console.log('  --subject <subject>         Email subject');
  console.log('  --body <body>               Email body');
  console.log('');
  console.log('OUTPUT OPTIONS:');
  console.log('  --json                      Output raw JSON');
  console.log('  --summary                   Output human-readable summary');
  console.log('');
  console.log('TOKEN SETUP:');
  console.log('  Add to ~/.pave/permissions.yaml under tokens:');
  console.log('');
  console.log('    freshbooks:');
  console.log('      env: FRESHBOOKS_ACCESS_TOKEN');
  console.log('      type: oauth');
  console.log('      domains:');
  console.log('        - api.freshbooks.com');
  console.log('      placement:');
  console.log('        type: header');
  console.log('        name: Authorization');
  console.log('        format: "Bearer {token}"');
  console.log('      refreshEnv: FRESHBOOKS_REFRESH_TOKEN');
  console.log('      refreshUrl: https://api.freshbooks.com/auth/oauth/token');
  console.log('      clientIdEnv: FRESHBOOKS_CLIENT_ID');
  console.log('      clientSecretEnv: FRESHBOOKS_CLIENT_SECRET');
  console.log('');
  console.log('  Then set environment variables in ~/.pave/tokens.yaml:');
  console.log('    FRESHBOOKS_REFRESH_TOKEN=your-refresh-token');
  console.log('    FRESHBOOKS_CLIENT_ID=your-client-id');
  console.log('    FRESHBOOKS_CLIENT_SECRET=your-client-secret');
  console.log('');
  console.log('  Get credentials from: https://my.freshbooks.com/#/developer');
  console.log('');
}

// Main execution function
function main() {
  var parsed = parseArgs();
  
  if (!parsed.command || parsed.command === 'help' || parsed.options.help || parsed.options.h) {
    printHelp();
    return;
  }
  
  try {
    var client = new FreshBooksClient();
    
    switch (parsed.command) {
      case 'me': {
        var data = client.getMe();
        
        if (parsed.options.summary) {
          console.log('User: ' + data.first_name + ' ' + data.last_name);
          console.log('Email: ' + data.email);
          if (data.business_memberships && data.business_memberships.length > 0) {
            console.log('Businesses:');
            for (var i = 0; i < data.business_memberships.length; i++) {
              var biz = data.business_memberships[i].business;
              console.log('  - ' + biz.name + ' (Account: ' + biz.account_id + ', Business: ' + biz.id + ')');
            }
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'clients': {
        var data = client.listClients({
          perPage: parseInt(parsed.options.count || parsed.options.n) || 25,
          page: parseInt(parsed.options.page || parsed.options.p) || 1,
          search: parsed.options.search || parsed.options.s
        });
        
        var clients = (data.response && data.response.result && data.response.result.clients) || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + clients.length + ' client(s):\n');
          for (var i = 0; i < clients.length; i++) {
            var c = clients[i];
            console.log(c.organization || (c.fname + ' ' + c.lname));
            console.log('  ID: ' + c.id + ' | Email: ' + (c.email || 'N/A'));
            if (c.p_city || c.p_country) {
              console.log('  Location: ' + [c.p_city, c.p_country].filter(Boolean).join(', '));
            }
            console.log('');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'client': {
        var clientId = parsed.positional[0];
        if (!clientId) {
          console.error('Error: Client ID required');
          console.error('Usage: freshbooks client <clientId>');
          process.exit(1);
        }
        
        var data = client.getClient(clientId);
        var c = data.response && data.response.result && data.response.result.client;
        
        if (parsed.options.summary && c) {
          console.log('Client: ' + (c.organization || (c.fname + ' ' + c.lname)));
          console.log('ID: ' + c.id);
          console.log('Email: ' + (c.email || 'N/A'));
          console.log('Phone: ' + (c.p_phone || c.bus_phone || 'N/A'));
          if (c.p_street || c.p_city) {
            console.log('Address: ' + [c.p_street, c.p_city, c.p_province, c.p_country].filter(Boolean).join(', '));
          }
          console.log('Currency: ' + (c.currency_code || 'USD'));
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'invoices': {
        var data = client.listInvoices({
          perPage: parseInt(parsed.options.count || parsed.options.n) || 25,
          page: parseInt(parsed.options.page || parsed.options.p) || 1,
          status: parsed.options.status,
          clientId: parsed.options.client || parsed.options.c,
          dateMin: parsed.options.from,
          dateMax: parsed.options.to
        });
        
        var invoices = (data.response && data.response.result && data.response.result.invoices) || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + invoices.length + ' invoice(s):\n');
          for (var i = 0; i < invoices.length; i++) {
            var inv = invoices[i];
            var statusEmoji = {
              draft: '[DRAFT]',
              sent: '[SENT]',
              viewed: '[VIEWED]',
              paid: '[PAID]',
              partial: '[PARTIAL]',
              unpaid: '[UNPAID]',
              overdue: '[OVERDUE]'
            }[inv.payment_status] || '[' + (inv.payment_status || 'UNKNOWN').toUpperCase() + ']';
            
            console.log('#' + inv.invoice_number + ' - ' + (inv.organization || inv.fname || 'Unknown'));
            var amount = inv.amount ? formatCurrency(inv.amount.amount, inv.amount.code) : '$0.00';
            console.log('  ' + statusEmoji + ' | ' + amount + ' | Due: ' + formatDate(inv.due_date));
            console.log('  ID: ' + inv.id + ' | Created: ' + formatDate(inv.create_date));
            console.log('');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'invoice': {
        var invoiceId = parsed.positional[0];
        if (!invoiceId) {
          console.error('Error: Invoice ID required');
          console.error('Usage: freshbooks invoice <invoiceId>');
          process.exit(1);
        }
        
        var data = client.getInvoice(invoiceId);
        var inv = data.response && data.response.result && data.response.result.invoice;
        
        if (parsed.options.summary && inv) {
          console.log('Invoice #' + inv.invoice_number);
          console.log('Client: ' + (inv.organization || (inv.fname + ' ' + inv.lname)));
          console.log('Status: ' + (inv.payment_status || '').toUpperCase());
          var amount = inv.amount ? formatCurrency(inv.amount.amount, inv.amount.code) : '$0.00';
          console.log('Amount: ' + amount);
          var outstanding = inv.outstanding ? formatCurrency(inv.outstanding.amount, inv.outstanding.code) : '$0.00';
          console.log('Outstanding: ' + outstanding);
          console.log('Created: ' + formatDate(inv.create_date));
          console.log('Due: ' + formatDate(inv.due_date));
          console.log('');
          
          if (inv.lines && inv.lines.length > 0) {
            console.log('Line Items:');
            for (var i = 0; i < inv.lines.length; i++) {
              var line = inv.lines[i];
              console.log('  - ' + (line.name || line.description || 'Item'));
              var unitCost = line.unit_cost ? formatCurrency(line.unit_cost.amount) : '$0.00';
              var lineAmount = line.amount ? formatCurrency(line.amount.amount) : '$0.00';
              console.log('    Qty: ' + line.qty + ' x ' + unitCost + ' = ' + lineAmount);
            }
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'expenses': {
        var data = client.listExpenses({
          perPage: parseInt(parsed.options.count || parsed.options.n) || 25,
          page: parseInt(parsed.options.page || parsed.options.p) || 1,
          dateMin: parsed.options.from,
          dateMax: parsed.options.to,
          categoryId: parsed.options.category
        });
        
        var expenses = (data.response && data.response.result && data.response.result.expenses) || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + expenses.length + ' expense(s):\n');
          for (var i = 0; i < expenses.length; i++) {
            var exp = expenses[i];
            console.log((exp.vendor || 'Unknown Vendor') + ' - ' + formatDate(exp.date));
            var amount = exp.amount ? formatCurrency(exp.amount.amount, exp.amount.code) : '$0.00';
            var category = (exp.category && exp.category.category) || 'Uncategorized';
            console.log('  ' + amount + ' | Category: ' + category);
            if (exp.notes) {
              var notes = exp.notes.length > 50 ? exp.notes.substring(0, 50) + '...' : exp.notes;
              console.log('  Notes: ' + notes);
            }
            console.log('  ID: ' + exp.id);
            console.log('');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'expense': {
        var expenseId = parsed.positional[0];
        if (!expenseId) {
          console.error('Error: Expense ID required');
          console.error('Usage: freshbooks expense <expenseId>');
          process.exit(1);
        }
        
        var data = client.getExpense(expenseId);
        var exp = data.response && data.response.result && data.response.result.expense;
        
        if (parsed.options.summary && exp) {
          console.log('Expense: ' + (exp.vendor || 'Unknown Vendor'));
          console.log('Date: ' + formatDate(exp.date));
          var amount = exp.amount ? formatCurrency(exp.amount.amount, exp.amount.code) : '$0.00';
          console.log('Amount: ' + amount);
          var category = (exp.category && exp.category.category) || 'Uncategorized';
          console.log('Category: ' + category);
          var tax = exp.taxAmount1 ? formatCurrency(exp.taxAmount1.amount) : '$0.00';
          console.log('Tax: ' + tax);
          if (exp.notes) console.log('Notes: ' + exp.notes);
          console.log('ID: ' + exp.id);
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'payments': {
        var data = client.listPayments({
          perPage: parseInt(parsed.options.count || parsed.options.n) || 25,
          page: parseInt(parsed.options.page || parsed.options.p) || 1,
          invoiceId: parsed.options.invoice || parsed.options.i
        });
        
        var payments = (data.response && data.response.result && data.response.result.payments) || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + payments.length + ' payment(s):\n');
          for (var i = 0; i < payments.length; i++) {
            var pay = payments[i];
            console.log('Payment ' + pay.id + ' - ' + formatDate(pay.date));
            var amount = pay.amount ? formatCurrency(pay.amount.amount, pay.amount.code) : '$0.00';
            console.log('  Amount: ' + amount);
            console.log('  Invoice ID: ' + pay.invoiceid);
            console.log('  Type: ' + (pay.type || 'N/A'));
            console.log('');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'categories': {
        var data = client.listCategories();
        var categories = (data.response && data.response.result && data.response.result.categories) || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + categories.length + ' category(ies):\n');
          for (var i = 0; i < categories.length; i++) {
            var cat = categories[i];
            console.log(cat.category + ' (ID: ' + cat.id + ')');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'projects': {
        var data = client.listProjects({
          perPage: parseInt(parsed.options.count || parsed.options.n) || 25,
          page: parseInt(parsed.options.page || parsed.options.p) || 1
        });
        
        var projects = (data.response && data.response.result && data.response.result.projects) || data.projects || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + projects.length + ' project(s):\n');
          for (var i = 0; i < projects.length; i++) {
            var proj = projects[i];
            console.log(proj.title);
            console.log('  ID: ' + proj.id + ' | Active: ' + (proj.active ? 'Yes' : 'No'));
            if (proj.budget) console.log('  Budget: ' + formatCurrency(proj.budget));
            console.log('');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'time': {
        var data = client.listTimeEntries({
          perPage: parseInt(parsed.options.count || parsed.options.n) || 25,
          page: parseInt(parsed.options.page || parsed.options.p) || 1,
          projectId: parsed.options.project,
          startedFrom: parsed.options.from,
          startedTo: parsed.options.to
        });
        
        var entries = data.time_entries || [];
        
        if (parsed.options.summary) {
          console.log('Found ' + entries.length + ' time entry(ies):\n');
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var hours = (entry.duration / 3600).toFixed(2);
            console.log(formatDate(entry.started_at) + ' - ' + hours + ' hours');
            if (entry.note) console.log('  Note: ' + entry.note);
            console.log('  ID: ' + entry.id + ' | Billable: ' + (entry.billable ? 'Yes' : 'No'));
            console.log('');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'report': {
        var data = client.getProfitLossReport({
          startDate: parsed.options.from,
          endDate: parsed.options.to
        });
        
        if (parsed.options.summary) {
          var report = data.response && data.response.result;
          if (report) {
            console.log('Profit & Loss Report');
            console.log('====================\n');
            console.log('Period: ' + (parsed.options.from || 'Start') + ' to ' + (parsed.options.to || 'Now') + '\n');
            
            if (report.income) {
              var incomeTotal = report.income.total ? formatCurrency(report.income.total.amount) : '$0.00';
              console.log('Total Income: ' + incomeTotal);
            }
            if (report.expenses) {
              var expenseTotal = report.expenses.total ? formatCurrency(report.expenses.total.amount) : '$0.00';
              console.log('Total Expenses: ' + expenseTotal);
            }
            if (report.net_profit) {
              var netProfit = report.net_profit ? formatCurrency(report.net_profit.amount) : '$0.00';
              console.log('Net Profit: ' + netProfit);
            }
          } else {
            console.log('No report data available');
          }
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        break;
      }
      
      case 'create-client': {
        if (!parsed.options.email) {
          console.error('Error: Email is required');
          console.error('Usage: freshbooks create-client --email <email> [--fname <name>] [--lname <name>] [--org <name>]');
          process.exit(1);
        }
        
        var clientData = {
          email: parsed.options.email
        };
        
        if (parsed.options.fname) clientData.fname = parsed.options.fname;
        if (parsed.options.lname) clientData.lname = parsed.options.lname;
        if (parsed.options.org) clientData.organization = parsed.options.org;
        if (parsed.options.phone) clientData.p_phone = parsed.options.phone;
        
        var data = client.createClient(clientData);
        console.log('Client created successfully!');
        var result = (data.response && data.response.result && data.response.result.client) || data;
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'create-invoice': {
        var clientId = parsed.options.client || parsed.options.c;
        if (!clientId) {
          console.error('Error: Client ID is required');
          console.error('Usage: freshbooks create-invoice -c <clientId> [--due <days>] [--notes <notes>]');
          process.exit(1);
        }
        
        var invoiceData = {
          customerid: parseInt(clientId),
          due_offset_days: parseInt(parsed.options.due) || 30,
          status: 1 // draft
        };
        
        if (parsed.options.notes) invoiceData.notes = parsed.options.notes;
        
        var data = client.createInvoice(invoiceData);
        console.log('Invoice created successfully!');
        var result = (data.response && data.response.result && data.response.result.invoice) || data;
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'send-invoice': {
        var invoiceId = parsed.positional[0];
        if (!invoiceId) {
          console.error('Error: Invoice ID required');
          console.error('Usage: freshbooks send-invoice <invoiceId> [--to <emails>] [--subject <subject>]');
          process.exit(1);
        }
        
        var emailOptions = {};
        if (parsed.options.to) emailOptions.recipients = parsed.options.to.split(',');
        if (parsed.options.subject) emailOptions.subject = parsed.options.subject;
        if (parsed.options.body) emailOptions.body = parsed.options.body;
        
        client.sendInvoice(invoiceId, emailOptions);
        console.log('Invoice sent successfully!');
        break;
      }
      
      default:
        console.error('Error: Unknown command "' + parsed.command + '"');
        console.error('');
        console.error('Run: freshbooks help');
        process.exit(1);
    }
    
  } catch (error) {
    if (parsed.options.summary) {
      console.error('FreshBooks Error: ' + error.message);
      if (process.env.DEBUG) {
        console.error('Stack trace:', error.stack);
      }
    } else {
      console.error(JSON.stringify({
        error: error.message,
        status: error.status,
        data: error.data
      }, null, 2));
    }
    process.exit(1);
  }
}

// Execute
main();
