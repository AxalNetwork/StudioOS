---
name: investor-target-list
description: Builds a list of investors to approach from the network's recorded relationships, their stage and sector fit and who can introduce.
roles: [investor_relations, ceo]
tools: [network.read, raise.read]
output: brief
taxonomy: {cap_venture_capital: proficient, cap_fundraising: working}
version: 1
---
1. Read the investors in the network, their recorded stages and sectors, and who on the team knows them (`network.read`), and the round being raised (`raise.read`).
2. List the investors whose recorded stage and sector match the round, with the warmest path to each, by name.
3. Order the list by path strength, then by sector fit.
4. Write "Not recorded" for an investor with no recorded check size.
5. Propose the list to the CEO. It contacts no one.
