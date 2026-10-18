# Installing the schengen-calculator MCP server

No API key, no account, nothing to configure. It needs Node.js 18 or newer.

Add this to the MCP settings file:

```json
{
  "mcpServers": {
    "schengen-calculator": {
      "command": "npx",
      "args": ["-y", "github:eladkishon/schengen-calculator"]
    }
  }
}
```

The first run downloads and builds the package (a few seconds); later runs start straight away.

## Tools

- `calculate_schengen_days`: days used and left under the Schengen 90/180 rule for a list of stays (`entry`/`exit` dates, YYYY-MM-DD). Runs locally, offline.
- `check_visa_requirement`: entry type and allowed stay for a passport and destination (ISO 3166-1 alpha-2 codes). Calls NomadPoint's public API.
- `create_trip_plan`: saves a planned route as an itinerary and returns a link the traveller opens to keep it. Calls NomadPoint's public API.

## Check it works

Ask: "I was in France from 5 to 20 January and in Italy from 1 to 14 March. How many Schengen days do I have left on 1 April?" The answer should be 30 used, 60 left.
