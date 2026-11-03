# Chorklist

Track your household's recurring chores: who's on it, when it's due, and who did it last.

![Chores grouped by Overdue, Today, This week and Later](docs/screenshot.png)

## Features

- **Recurring schedules**: every N days, weeks, months or years. The next due date is counted from when the chore was *actually* done, so a late chore doesn't pile up.
- **At-a-glance list**: chores grouped into Overdue, Today, This week and Later.
- **Household members**: assign chores to someone or leave them for "Anyone", and filter the list by person.
- **Rotation**: optionally pass a chore to the next person each time it's completed.
- **One-tap done** with **Undo**, plus a history of who did what.
- **Shared**: one small server holds the data, so everyone on your home network sees the same list from a phone or computer. It can be added to a phone's home screen.
- **No dependencies**: just Node.js 18 or newer.

## Getting started

```sh
npm start
```

Open http://localhost:3000. Other devices on your Wi-Fi can use `http://<this-computer's-IP>:3000`.

1. Go to **Household** and add everyone who shares the chores.
2. Go to **Chores**, tap **+ Add chore**, and set how often it repeats.
3. Pick your name in the **I'm** menu (top right) so completions are credited to you.
4. Tap ✓ when a chore is done. Tap a chore to edit or delete it.

### Configuration

| Variable          | Default                | Description                 |
| ----------------- | ---------------------- | --------------------------- |
| `PORT`            | `3000`                 | Port to listen on           |
| `HOST`            | `0.0.0.0`              | Interface to bind           |
| `CHORKLIST_DATA`  | `data/chorklist.json`  | Where your data is saved    |

Data is a plain JSON file. Back it up by copying it.

> Chorklist has no login. Run it on your home network, and don't expose it to the internet without putting authentication in front of it.

## Development

```sh
npm test
```

- `server.js`: HTTP server, JSON API and static file serving
- `lib/schedule.js`: due date math (date strings only, so time zones and daylight saving don't matter)
- `lib/store.js`: validation and JSON file persistence
- `public/`: the web app (plain HTML, CSS and JS)

### API

| Method | Path                         | Body                                                                 |
| ------ | ---------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/state?today=YYYY-MM-DD`| Returns members, chores with due status, and recent history          |
| POST   | `/api/members`               | `{ name }`                                                           |
| DELETE | `/api/members/:id`           |                                                                      |
| POST   | `/api/chores`                | `{ name, every, unit, startDate, assigneeId?, rotate?, room?, notes? }` |
| PUT    | `/api/chores/:id`            | any chore fields                                                     |
| DELETE | `/api/chores/:id`            |                                                                      |
| POST   | `/api/chores/:id/complete`   | `{ memberId?, date? }`                                               |
| DELETE | `/api/history/:id`           | Undo a completion                                                    |
