/** Role catalogue shared by the rules and the UI. */
export const ROLES = {
  villager: {
    name: 'Villager',
    team: 'town',
    icon: '🧑‍🌾',
    blurb: 'No special powers. Find the mafia by talking and voting during the day.',
  },
  doctor: {
    name: 'Doctor',
    team: 'town',
    icon: '🩺',
    blurb: 'Each night, choose someone to protect from being killed. You can’t protect the same person two nights in a row.',
    night: 'protect',
  },
  cop: {
    name: 'Detective',
    team: 'town',
    icon: '🕵️',
    blurb: 'Each night, investigate someone to learn whether they are mafia.',
    night: 'investigate',
  },
  vigilante: {
    name: 'Vigilante',
    team: 'town',
    icon: '🎯',
    blurb: 'You have one bullet. At night you may shoot someone you think is mafia.',
    night: 'shoot',
  },
  mafioso: {
    name: 'Mafioso',
    team: 'mafia',
    icon: '🔪',
    blurb: 'Each night, agree with the mafia on someone to kill. Win when the mafia equal or outnumber everyone else.',
    night: 'kill',
  },
  godfather: {
    name: 'Godfather',
    team: 'mafia',
    icon: '🎩',
    blurb: 'Leader of the mafia. You choose the final kill target and you look innocent to the Detective.',
    night: 'kill',
  },
  jester: {
    name: 'Jester',
    team: 'neutral',
    icon: '🃏',
    blurb: 'You win if the town votes to execute you. Act suspicious — but not too suspicious.',
  },
};

export const TEAM_LABEL = { town: 'Town', mafia: 'Mafia', neutral: 'Neutral' };

export const ACTION_LABEL = {
  kill: 'Choose someone to kill',
  protect: 'Choose someone to protect',
  investigate: 'Choose someone to investigate',
  shoot: 'Shoot someone (one bullet)',
};
