const istFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

let fixedToday: string | null = null;

// All business dates are IST calendar dates as "YYYY-MM-DD".
// Tests and the seed script can pin "today" to exercise interest over time.
export const clock = {
  today: () => fixedToday ?? istFormatter.format(new Date()),
  setToday: (date: string | null) => {
    fixedToday = date;
  },
};
