// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../../src/App";
import { DemoProvider } from "../../src/auth/demoAuth";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

function renderApp(path = "/") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>,
  );
  return user;
}

async function signIn(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole("button", { name }));
}

/** Opens the seeded room from the home page. */
async function openSeededRoom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: /Platform Summit/ }));
  return screen.findByRole("heading", { level: 1, name: /Platform Summit/ });
}

describe("demo sign-in", () => {
  it("shows the demo banner and persona picker, then the home page for the chosen persona", async () => {
    const user = renderApp();
    expect(screen.getByText(/Demo mode\./)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Platform Summit/ })).not.toBeInTheDocument();
    await signIn(user, /Cleo Duarte/);
    expect(await screen.findByRole("heading", { level: 1, name: /Welcome, Cleo Duarte/ })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Platform Summit/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: /Choose a demo identity/ })).toBeInTheDocument();
  });

  it("switches persona from the header", async () => {
    const user = renderApp();
    await signIn(user, /Ada Okafor/);
    await user.selectOptions(await screen.findByLabelText("Demo user"), "demo_ben");
    expect(await screen.findByRole("heading", { level: 1, name: /Welcome, Ben Larsen/ })).toBeInTheDocument();
  });
});

describe("joining and hosting", () => {
  it("reports an unknown code and joins with the seeded one", async () => {
    const user = renderApp();
    await signIn(user, /Dev Rao/);
    await user.type(await screen.findByLabelText("Room code"), "ZZZZ-ZZZZ");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No room has that code");

    await user.clear(screen.getByLabelText("Room code"));
    await user.type(screen.getByLabelText("Room code"), "keyn-t4m7");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Platform Summit/ })).toBeInTheDocument();
  });

  it("creates a room and lands in it as host", async () => {
    const user = renderApp();
    await signIn(user, /Ada Okafor/);
    await user.type(await screen.findByLabelText("Event title"), "Retro night");
    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Retro night" })).toBeInTheDocument();
    expect(screen.getByText(/the host/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });

  it("surfaces validation errors from the backend", async () => {
    const user = renderApp();
    await signIn(user, /Ada Okafor/);
    await user.type(await screen.findByLabelText("Event title"), "ab");
    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 3 characters");
  });
});

describe("as a participant", () => {
  it("asks a question that waits for review, and upvotes an open one", async () => {
    const user = renderApp();
    await signIn(user, /Dev Rao/);
    await openSeededRoom(user);

    expect(screen.queryByRole("tab", { name: /Moderation/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Your question"), "What is the plan for plugins?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    expect(await screen.findByText(/A moderator will review it/)).toBeVisible();
    const mine = (await screen.findByText("What is the plan for plugins?")).closest("li") as HTMLElement;
    expect(within(mine).getByText("Awaiting review")).toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: /Upvote/ })).toBeDisabled();

    const open = screen.getByText("How do you decide what NOT to build when the roadmap is full?").closest("li") as HTMLElement;
    const vote = within(open).getByRole("button", { name: /Remove your upvote/ });
    expect(vote).toHaveAttribute("aria-pressed", "true");
    await user.click(vote);
    const toggled = await within(open).findByRole("button", { name: /Upvote: How do you decide/ });
    expect(toggled).toHaveAttribute("aria-pressed", "false");
    expect(within(open).getByText("1", { selector: ".vote-count" })).toBeInTheDocument();
  });

  it("explains rate limiting when questions are sent too quickly", async () => {
    const user = renderApp();
    await signIn(user, /Dev Rao/);
    await openSeededRoom(user);
    for (const text of ["First fresh question", "Second fresh question", "Third fresh question", "Fourth fresh question"]) {
      await user.type(screen.getByLabelText("Your question"), text);
      await user.click(screen.getByRole("button", { name: "Send question" }));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many requests.*Try again in \d+s/);
  });

  it("votes once in the open poll and then sees results", async () => {
    const user = renderApp();
    await signIn(user, /Ada Okafor/);
    await openSeededRoom(user);
    await user.click(screen.getByRole("tab", { name: "Polls" }));
    await user.click(await screen.findByRole("radio", { name: "Cost control" }));
    await user.click(screen.getByRole("button", { name: "Cast vote" }));
    expect(await screen.findByText(/3 votes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cast vote" })).not.toBeInTheDocument();
    expect(screen.getByText("(your vote)")).toBeInTheDocument();
  });

  it("cannot open the presenter view", async () => {
    const user = renderApp();
    await signIn(user, /Cleo Duarte/);
    await openSeededRoom(user);
    expect(screen.queryByRole("link", { name: "Presenter view" })).not.toBeInTheDocument();
  });
});

describe("as a moderator or host", () => {
  it("approves a pending question from the queue", async () => {
    const user = renderApp();
    await signIn(user, /Ben Larsen/);
    await openSeededRoom(user);
    await user.click(screen.getByRole("tab", { name: /Moderation/ }));
    expect(await screen.findByRole("heading", { name: "Awaiting review (2)" })).toBeInTheDocument();
    const card = (await screen.findByText("Are you hiring in the platform team?")).closest("li") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("heading", { name: "Awaiting review (1)" })).toBeInTheDocument();
  });

  it("puts a question on screen and shows it in the presenter view", async () => {
    const user = renderApp();
    await signIn(user, /Ben Larsen/);
    await openSeededRoom(user);
    const card = (await screen.findByText("Will the migration guide cover teams that cannot freeze deploys?")).closest("li") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Show on screen" }));
    await user.click(screen.getByRole("link", { name: "Presenter view" }));

    const stage = (await screen.findByRole("heading", { name: "On screen", hidden: true })).closest("section") as HTMLElement;
    expect(within(stage).getByText(/Will the migration guide cover/)).toBeInTheDocument();
    expect(screen.getByText("Which topic should the next workshop cover?")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Top questions" })).toBeInTheDocument();
  });

  it("starts a poll, and the host manages people and the room", async () => {
    const user = renderApp();
    await signIn(user, /Ada Okafor/);
    await openSeededRoom(user);

    await user.click(screen.getByRole("tab", { name: "Polls" }));
    await user.type(await screen.findByLabelText("Question"), "Lunch?");
    await user.type(screen.getByLabelText("Option 1"), "Pizza");
    await user.type(screen.getByLabelText("Option 2"), "Salad");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getByLabelText("Option 3"), "Soup");
    await user.click(screen.getByRole("button", { name: "Remove option 3" }));
    await user.click(screen.getByRole("button", { name: "Start poll" }));
    expect(await screen.findByRole("heading", { name: "Lunch?" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.selectOptions(await screen.findByLabelText("Role for Cleo Duarte"), "moderator");
    await user.click(screen.getByRole("button", { name: "Close room" }));
    expect(await screen.findByRole("button", { name: "Reopen room" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Questions" }));
    expect(await screen.findByText(/This room is closed/)).toBeInTheDocument();
  });
});

describe("accessibility behaviours", () => {
  it("moves between tabs with the arrow keys", async () => {
    const user = renderApp();
    await signIn(user, /Ben Larsen/);
    await openSeededRoom(user);
    const questions = screen.getByRole("tab", { name: "Questions" });
    questions.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Polls" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Polls" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Moderation/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(questions).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: /Moderation/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(questions).toHaveFocus();
  });

  it("toggles the theme and remembers it", async () => {
    const user = renderApp();
    await user.click(screen.getByRole("button", { name: "Toggle light and dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Toggle light and dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("quorum-theme")).toBe("light");
  });

  it("shows a not-found page for unknown routes and a clear error for unknown rooms", async () => {
    const user = renderApp("/nope");
    await signIn(user, /Cleo Duarte/);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    cleanup();
    const second = renderApp("/r/room_999");
    await signIn(second, /Cleo Duarte/);
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found");
  });
});
