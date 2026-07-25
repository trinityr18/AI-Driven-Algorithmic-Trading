# Start Here

Double-click:

```text
Launch Dashboard.bat
```

The launcher checks what is missing, installs what it can, starts the backend and frontend, and opens:

```text
http://127.0.0.1:5173
```

It handles fresh machines too:

- If Python 3.12+ is missing, it installs it and adds known Python folders to PATH.
- If Node.js 20+ / npm is missing, it installs it and adds known Node folders to PATH.
- If app dependencies are missing, it installs them.

On Windows, installs use `winget`. If Windows asks you to reopen the terminal after installing Python or Node.js, do that and double-click `Launch Dashboard.bat` again.

Sandbox login details are shown on the dashboard login screen.
