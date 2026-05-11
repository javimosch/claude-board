# Claude Board - Daemon Management

The Claude UI PoC application is now accessible as a system-wide command with daemon management capabilities via systemd.

## Quick Start

### Install as Daemon
```bash
claude-board install
```

This command:
- Checks Bun is installed
- Installs project dependencies
- Creates a systemd user service
- Enables the service for auto-start

### Start the Service
```bash
claude-board start
```

Access the UI at **http://localhost:3000**

### Stop the Service
```bash
claude-board stop
```

### Check Service Status
```bash
claude-board status
```

Shows whether the service is running, memory/CPU usage, and recent logs.

### Restart the Service
```bash
claude-board restart
```

### View Service Logs
```bash
# Show latest logs (follows output)
claude-board logs -f

# Show last 50 lines
claude-board logs -n 50

# Show last 10 lines without paging
claude-ui-poc logs -n 10 --no-pager
```

### Uninstall the Daemon
```bash
claude-ui-poc uninstall
```

Disables and removes the systemd service.

## How It Works

### Installation Flow
1. **Dependency Installation**: Runs `bun install` in the project root
2. **Service File Creation**: Creates a systemd user service file at:
   - `~/.config/systemd/user/claude-ui-poc.service`
3. **Service Registration**: Registers with systemd using `systemctl --user`
4. **Auto-Start Configuration**: Enables the service to auto-start when you log in

### Service Configuration
The systemd service file:
- **Working Directory**: `/home/jarancibia/ai/system/claude-ui-poc`
- **Command**: `/home/jarancibia/.bun/bin/bun /home/jarancibia/ai/system/claude-ui-poc/src/server.ts`
- **Restart Policy**: Automatically restarts on failure with 5-second delay
- **Logging**: Integrated with system journal (journalctl)

### Accessing Logs
Service logs are captured in the system journal and accessible via:
```bash
# Follow live logs
journalctl --user -u claude-ui-poc -f

# Show last 50 entries
journalctl --user -u claude-ui-poc -n 50

# Show errors only
journalctl --user -u claude-ui-poc -p err

# Show logs since 1 hour ago
journalctl --user -u claude-ui-poc --since "1 hour ago"
```

## Path Details

| Component | Location |
|-----------|----------|
| CLI Script | `~/.local/bin/claude-ui-poc` |
| Project Root | `/home/jarancibia/ai/system/claude-ui-poc` |
| Service File | `~/.config/systemd/user/claude-ui-poc.service` |
| Log Directory | `~/.local/share/claude-ui-poc` |
| Systemd User Config | `~/.config/systemd/user/` |

## Requirements

- **Bun**: Must be installed and accessible via `bun` command
- **Node.js**: Not required (Bun runtime is sufficient)
- **systemd**: Linux with user-level systemd support

## Environment Details

The service runs as a **user-level** systemd service, meaning:
- No root/sudo required
- Service runs as your user
- Starts automatically when you log in
- Logs are in your user journal
- Service file location: `~/.config/systemd/user/`

## Troubleshooting

### Port 3000 Already in Use
If the service fails to start with "EADDRINUSE":
```bash
# Find the process using port 3000
lsof -i :3000

# Kill the process
kill <PID>

# Restart the service
claude-ui-poc restart
```

### Dependencies Not Installed
If you get module not found errors:
```bash
cd /home/jarancibia/ai/system/claude-ui-poc
bun install
```

### Check Service Status Details
For detailed information about why the service isn't running:
```bash
journalctl --user -u claude-ui-poc -n 50 --no-pager
```

### Manually Test the Server
```bash
cd /home/jarancibia/ai/system/claude-ui-poc
bun src/server.ts
```

This runs the server in the foreground for debugging.

## Advanced Usage

### Permanently Enable Auto-Start
The service is automatically enabled during `install`. To manually ensure it's enabled:
```bash
systemctl --user enable claude-ui-poc.service
```

### Disable Auto-Start (Keep Installed)
```bash
systemctl --user disable claude-ui-poc.service
```

### Check if Service is Enabled
```bash
systemctl --user is-enabled claude-ui-poc.service
```

### Monitor Resource Usage
```bash
systemctl --user status claude-ui-poc.service
```

Shows memory, CPU, and process details.

## Security Notes

- The service runs with your user's permissions
- No root access required or used
- Database and credentials are stored in the project directory
- Service logs are accessible via your user's journal
- The symlink at `~/.local/bin/claude-ui-poc` allows system-wide access
