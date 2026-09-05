# Tracker V1 Product Requirements — Agent Handoff

**Status:** Working V1 product-direction PRD  
**Purpose:** Give another agent the intended product behavior without prescribing unconfirmed interface or implementation decisions.  
**Authority:** Requirements labeled **Confirmed** reflect the current product direction. Items under **Open decisions** or **Design hypotheses** are not requirements.

## 1. Product mission

### Confirmed

Tracker exists to help people successfully see something cool in the sky.

Its first responsibility is not to teach astronomy. It should:

1. Determine what is realistically worth seeing from the user's location.
2. Put the best opportunity first.
3. Show when and where to look.
4. Help the user recognize it.
5. Offer a useful reminder.
6. Explain the science only when requested or when it directly helps the observation.

The product succeeds when the user stops looking at Tracker and looks at the sky.

The primary product outcome is a successful sighting, represented by an action such as **I saw it**.

## 2. V1 interaction contract

### Confirmed

V1 should require only the user's location, with a manual-location fallback if permission is unavailable.

V1 must not ask the user to:

- Create an equipment profile.
- State whether they are camping.
- Choose between eyes, binoculars, or telescope during onboarding.
- Enter telescope type, aperture, mount, eyepieces, or experience level.
- Complete a preference questionnaire before seeing a recommendation.

Equipment is a property of an observing opportunity, not a required property of the user.

Dark-sky quality should be inferred from location, local darkness, light pollution, and available conditions where data permits. A user at a campsite should automatically receive recommendations appropriate to that location without declaring that they are camping.

Telescope owners should be served by clearly identifying worthwhile telescope opportunities and providing useful telescope guidance after the user chooses one. Selecting a telescope opportunity is enough context for that interaction; V1 does not need to remember or model the user's equipment.

The initial experience must remain useful with no information beyond location and time.

## 3. Core user experience

### Confirmed

When Tracker opens, it should immediately present:

- A visual representation of the best current or upcoming opportunity.
- A concise explanation of what the user can see.
- The best time and direction to look.
- A direct observation or reminder action.
- A ranked list of other upcoming phenomena.

The visual and ranked list are one system. The highest-ranked item determines the primary visual. Selecting another item updates the visual and guidance.

The product should support these time perspectives:

- **Now:** Visible immediately or beginning soon.
- **Tonight:** The flagship view for the current local observing night.
- **Upcoming:** Future opportunities beyond tonight.
- **Calendar:** Date-oriented planning and reminder/export access.

“Tonight” follows the local period of useful evening and overnight observation, including time after midnight. It is not limited to the current calendar date.

The exact navigation model and page layout are not decided. The requirement is that the visual, recommendation, and ranked alternatives are available immediately without catalog browsing.

## 4. Ranking behavior

### Confirmed

Tracker should rank by the likelihood of a satisfying, successful observation—not by scientific importance, nominal event magnitude, or popularity alone.

Ranking should consider only factors physically relevant to each phenomenon, including:

- Whether it is observable from the user's location and time.
- Whether the user is likely to notice and recognize it.
- Visual or experiential impact.
- Timing, duration, and urgency.
- Required effort and equipment.
- Local darkness, Moon, clouds, horizon, and light pollution where relevant.
- Confidence and forecast horizon.
- Rarity or significance when it meaningfully improves the experience.

The default ranking should favor opportunities that can be seen without special equipment. An equipment-dependent event may still be prominent, but its requirement must be unmistakable before the user commits to it.

Scientific significance, rarity, visual spectacle, practical opportunity, and confidence are different qualities. The implementation must not collapse them into an opaque score that produces implausible recommendations.

Weak events should not be promoted merely to populate the interface. They may remain available in a secondary or expanded list.

If no exceptional event is available, Tracker should recommend the easiest genuinely worthwhile target without exaggerating it.

## 5. Information priority

### Confirmed

Tracker should actively present information that increases anticipation or improves the chance of a successful observation.

Active information includes:

- What is worth seeing.
- Why it is worth trying tonight.
- When and where to look.
- How long to watch.
- What it should look like to the unaided eye.
- The minimum equipment required.
- A constructive response to a problem, such as a better clear-sky window.
- Safety information.
- A material correction to an observation the user already planned.

Technical, discouraging, or low-value information should remain passive but accessible. This includes detailed model uncertainty, source age, low-ranked events, full numerical inputs, and the reason an event was demoted.

Tracker should not foreground messages such as **Skip**, **Marginal**, **The peak has passed**, or **Nothing good tonight** unless a correction is required to prevent wasted effort.

The product must be encouraging without misleading the user about brightness, frequency, color, or certainty.

## 6. Visual behavior

### Confirmed

The initial visual is functional, not decorative. It should help the user understand one or more of:

- Where to look.
- How the phenomenon moves.
- When its intensity improves or declines.
- What the user is likely to perceive.

Each phenomenon should use an appropriate visual model. A generic globe, sky map, photograph, or event card is not sufficient for every case.

Visuals must distinguish:

- Observation from forecast.
- Forecast from seasonal likelihood.
- Probability from visual intensity.
- Human-eye appearance from camera appearance.
- Simulated behavior from predicted behavior.

The exact visual treatment is a design decision, provided it fulfills these requirements.

## 7. Phenomenon requirements

### 7.1 Satellite and ISS passes

#### Confirmed

Tracker should communicate the pass as a precise visual event:

- When and where it appears.
- Its path through the local sky.
- How high it gets.
- How long it remains visible.
- Where it disappears or fades into Earth's shadow.
- How to distinguish it from an aircraft.

The visual should make the local path and movement understandable. The exact use of a horizon view, sky map, compass, or camera alignment is not prescribed.

### 7.2 Meteor activity

#### Confirmed

Tracker should estimate what the user may actually experience, rather than present a shower's ideal Zenithal Hourly Rate as the user's expected count.

The estimate should account for available local and seasonal factors such as:

- All active showers, not only the best-known one.
- Sporadic meteors.
- Radiant position and local geometry.
- Moonlight, twilight, light pollution, and clouds where available.
- The difference between bright and faint meteor populations.

The promoted output should be understandable as an expected visible rate, range, cadence, or relative intensity across the night.

The visual should communicate changing activity and useful viewing direction. If animation or simulated meteor paths are used, they must be labeled as an estimate and must not imply prediction of individual meteors.

During meteor season, Tracker should represent the combined meteor sky and the best remaining opportunity. The fact that a nominal peak has passed should remain passive unless it materially changes tonight's recommendation.

At a dark location, meteor activity should naturally rank higher when the observing opportunity improves. No camping declaration is required.

### 7.3 Aurora

#### Confirmed

Tracker should provide a visual estimate of auroral activity inspired by weather-map products such as Ventusky, while completing the local guidance Ventusky does not provide.

The product must distinguish:

- The source model's geographic activity or occurrence probability.
- Whether the aurora may be visible from the user's location.
- Where in the local sky to look.
- Whether the expected result is camera-only, faint to the eye, or clearly visible.

A user can sometimes see aurora on the horizon even when the modeled activity is not directly overhead. The local recommendation must not depend only on the model value at the user's exact ground coordinates.

Short-horizon nowcasts, tonight/tomorrow outlooks, and seasonal aurora context have different confidence and must not be presented as equivalent.

The visual must not use saturated photographic color as a promise of naked-eye appearance.

The exact relationship between the global activity view and the local guidance view remains a design decision.

### 7.4 Telescope opportunities

#### Confirmed

V1 should include especially worthwhile telescope targets without asking whether the user owns a telescope.

Every such opportunity should clearly state **Telescope required** or an equivalent requirement in the ranked list and detail view.

After the user selects it, Tracker should provide guidance appropriate to a general telescope observer, including:

- When and where to find the target.
- Whether it is likely to be visually rewarding through a typical amateur telescope.
- A realistic visual expectation rather than an astrophotograph.
- Simple finding or setup guidance when it can be given without knowing the user's equipment.

V1 should not make aperture-specific promises, prescribe a particular eyepiece, or rank based on an assumed instrument.

Aurora and meteor showers remain wide-field phenomena. Tracker should not imply that a telescope improves them.

### 7.5 Other phenomena

#### Confirmed target scope

Tracker should be capable of ranking and guiding additional worthwhile phenomena, including:

- Eclipses and significant Moon events.
- Planets, conjunctions, oppositions, and occultations.
- Comets and other transients when the evidence is adequate.
- Milky Way and zodiacal-light opportunities at dark locations.

Each new phenomenon needs its own definition of observability, expected appearance, useful guidance, visual treatment, and reliability.

## 8. Seasonal understanding

### Confirmed

Tracker should understand the sky seasonally rather than treat events as isolated calendar entries.

Seasonal ranking may combine:

- Annual activity windows.
- Local latitude and darkness.
- Year-specific Moon and event timing.
- Current observations and forecasts.
- Historical patterns, clearly labeled as such.
- Whether an opportunity is building, near its best, declining, or coming next.

Seasonality should mostly operate behind the recommendation. It should not turn the home screen into a lesson or editorial calendar.

The current dominant opportunity may control the hero: meteor activity during a strong shower period, an excellent satellite pass, an auroral storm, or an unusually good planetary view.

## 9. Observation guidance

### Confirmed

Every promoted opportunity should answer, as applicable:

- What will I see?
- When should I go outside?
- Which direction should I face?
- How high should I look?
- How long should I try?
- What equipment is required?
- What will it realistically look like?
- Is there a better nearby or later window?

Detailed science, provenance, and calculations should be available after these questions are answered.

Solar-viewing safety is mandatory, prominent, and cannot be hidden behind progressive disclosure.

## 10. Reminders and monetization

### Confirmed

Tracker must offer a way to remember an observation. V1 should provide at least one reminder path that does not create a developer delivery cost, such as an on-device notification or calendar event.

Potential reminder channels include push notification, email, and SMS. The launch channel mix is not yet decided.

The cost rule is strict:

> Any service that costs the developer money is available only to a currently paying user.

This applies to delivery, metered data, backend monitoring, server computation, storage, routing, and any other marginal service cost.

Examples of potentially free capabilities, when they create no developer cost:

- On-device calculations.
- On-device reminders.
- Calendar export.
- Bundled seasonal data.
- Public data fetched directly by the client when current provider terms permit it.

Examples that must be paid when they incur cost:

- Server-monitored or adaptively rescheduled alerts.
- Paid email or SMS delivery.
- Metered weather, cloud, terrain, map, routing, or light-pollution services.
- Multiple locations monitored by a backend.

SMS must not be offered as an unlimited service without a sustainable cost model.

Notifications should help the user act. Examples include **Go outside in 10 minutes**, **Look southwest**, or **The better clear-sky window is now 11:20 PM**.

Tracker should not send routine notifications that merely say an event is poor or that nothing is available.

Exact pricing and packaging are open decisions.

## 11. Reliability and honesty

### Confirmed

Tracker should preserve the distinction between:

- Deterministic geometry and ephemerides.
- Near-real-time observations or nowcasts.
- Forecasts.
- Seasonal or historical likelihood.

Source, age, forecast horizon, and limitations should be available passively. Stale or missing data becomes active only when it could give the user a wrong time, direction, visual expectation, or paid alert.

If live data becomes unavailable, Tracker may fall back to broader information but must not represent that fallback as current observation.

All visual estimates should be calibrated to realistic human perception. Camera-enhanced results may be shown separately.

## 12. V1 acceptance criteria

### A1 — Zero-input launch

After location is resolved, Tracker shows a useful visual and ranked recommendation without asking about equipment, camping, interests, or astronomy experience.

### A2 — Dark-location behavior

When the same user opens Tracker from a substantially darker location, phenomena that benefit from darkness receive an appropriate ranking improvement without the user selecting a camping mode.

### A3 — Telescope opportunity

A worthwhile telescope target appears with its requirement clearly marked. A user can select it and receive general guidance. Tracker never asks for or assumes a particular telescope in V1.

### A4 — Immediate satellite pass

When a strong pass begins soon, Tracker makes the appearance time, direction, path, and disappearance understandable and provides a direct observation/reminder action.

### A5 — Meteor season

Tracker shows the combined local opportunity from active showers and sporadic meteors, gives a realistic visible-rate estimate or cadence, and helps the user choose the best part of the night. It does not present ZHR as a guaranteed personal rate.

### A6 — Aurora near the horizon

Tracker can recommend looking toward a horizon when modeled activity may be visible from a distance. It distinguishes model activity from local viewability and realistic eye/camera appearance.

### A7 — Weak night

Tracker recommends an honestly worthwhile target or leaves lower-value events passive. It does not invent spectacle or send a “nothing good tonight” notification.

### A8 — Paid service boundary

A user without an active paid entitlement never receives a reminder, data product, or backend service that creates a developer cost.

## 13. Non-goals for V1

V1 is not:

- An equipment inventory or telescope configurator.
- A user-preference onboarding flow.
- A generic astronomy encyclopedia.
- A complete catalog of everything above the horizon.
- A social network.
- An operations tool for spacecraft or observatories.
- A photorealistic prediction of the sky.
- A product optimized for screen time.

## 14. Open decisions

The following are not yet decided:

- Native iOS, responsive web, or both.
- Exact V1 phenomenon and data-source sequencing.
- Exact home layout and navigation.
- Whether aurora uses a globe, map, horizon view, or combined treatment.
- How meteor intensity is visualized.
- Whether telescope opportunities use badges, a secondary section, or another treatment.
- Weather, cloud, light-pollution, terrain, ephemeris, and map providers.
- Account and paid-entitlement implementation.
- Reminder channel mix at launch.
- Subscription price and SMS allowance.
- Calibrated thresholds for aurora eye/camera categories.

## 15. Design hypotheses from research

These may inform design exploration but are not approved requirements:

- A Ventusky-like animated activity field is effective for showing the geographic extent and relative strength of aurora.
- A local horizon treatment may better answer where a specific observer should look.
- A meteor activity curve may be more truthful than a static peak number.
- A clearly labeled compressed meteor simulation may make expected intensity intuitive.
- A pass-list pattern is useful for satellites, but the first recommendation still benefits from an immediate directional visual.
- Telescope opportunities may be grouped or badged without requiring an equipment profile.

## 16. Research references

- Ventusky: https://www.ventusky.com/app
- NOAA OVATION aurora forecast: https://www.spaceweather.gov/products/aurora-30-minute-forecast
- NOAA aurora viewing guidance: https://www.spaceweather.gov/content/tips-viewing-aurora
- Global Meteor Network flux: https://globalmeteornetwork.org/flux/
- MeteorActive: https://apps.apple.com/us/app/meteoractive/id1205712190
- NASA Spot the Station: https://www.nasa.gov/missions/station/spot-the-station-frequently-asked-questions/
- Sky Tonight: https://apps.apple.com/us/app/sky-tonight-stargazing-guide/id1570594940
- TU Delft Urban Meteor Map: https://research.tudelft.nl/en/publications/urban-meteor-map-a-map-based-forecast-of-hourly-rates-for-visual-/

