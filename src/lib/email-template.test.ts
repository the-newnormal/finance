import { describe, expect, it } from "vitest";
import { claimDetails, renderEmail, type Email } from "./email-template";

const email: Email = {
  subject: "Your claim for $25.00 needs attention",
  badge: { label: "Not approved", tone: "warning" },
  heading: "Your claim wasn't approved",
  paragraphs: ["Hi Vol,", "Your claim wasn't approved. Here's what the reviewer said."],
  details: [["For", "Taxi <to> the venue"], ["Amount", "$25.00"]],
  callout: { label: "Reason", text: "The receipt is \"blurry\" & cut off." },
  closing: "You're welcome to submit a new claim with the corrections.",
  link: { href: "/claims/c1", label: "View claim" },
};

describe("renderEmail", () => {
  it("escapes everything members typed", () => {
    const { html } = renderEmail(email, "https://finance.test");
    expect(html).toContain("Taxi &lt;to&gt; the venue");
    expect(html).toContain("The receipt is &quot;blurry&quot; &amp; cut off.");
    expect(html).not.toContain("<to>");
  });

  it("links the button and the logo to the site, whatever its trailing slash", () => {
    const { html } = renderEmail(email, "https://finance.test/");
    expect(html).toContain('href="https://finance.test/claims/c1"');
    expect(html).toContain('src="https://finance.test/email-logo.png"');
  });

  it("leaves out the button and the logo without the site's address", () => {
    const { html, text } = renderEmail(email);
    expect(html).not.toContain("View claim");
    expect(html).not.toContain("email-logo.png");
    expect(text).not.toContain("View claim");
  });

  it("previews the message, not the greeting", () => {
    const { html } = renderEmail(email);
    expect(html).toMatch(/<div style="display:none[^"]*">Your claim wasn&#39;t approved\. Here&#39;s what the reviewer said\.<\/div>/);
  });

  it("writes a plain-text version with every part", () => {
    expect(renderEmail(email, "https://finance.test").text).toBe([
      "Your claim wasn't approved",
      "Hi Vol,",
      "Your claim wasn't approved. Here's what the reviewer said.",
      "For: Taxi <to> the venue\nAmount: $25.00",
      "Reason: The receipt is \"blurry\" & cut off.",
      "You're welcome to submit a new claim with the corrections.",
      "View claim: https://finance.test/claims/c1",
      "You're getting this because you have a New Normal Finance account.",
    ].join("\n\n"));
  });
});

describe("claimDetails", () => {
  it("lists what's known, in order, and leaves out the rest", () => {
    expect(claimDetails({ description: "Venue rental", vendor: "The Hall", amount: "$25.00", budget: "Iftar" }))
      .toEqual([["For", "Venue rental"], ["Vendor", "The Hall"], ["Amount", "$25.00"], ["Budget", "Iftar"]]);
    expect(claimDetails({ description: null, vendor: null, amount: "$25.00", budget: null })).toEqual([["Amount", "$25.00"]]);
  });
});
