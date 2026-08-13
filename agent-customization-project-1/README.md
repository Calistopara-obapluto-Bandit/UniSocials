# Agent Customization Project

## Overview
This project is designed to create a custom agent that issues a 1% commission to subadmins on ticket purchases. The agent is tailored to handle commission-related queries and actions efficiently, ensuring a smooth experience for both subadmins and users.

## Project Structure
- **.agent.md**: Configuration file for the custom agent, detailing its purpose and functionality.
- **README.md**: Overview of the project, setup instructions, and usage guidelines.
- **docs/commission-workflow.md**: Detailed workflow for calculating and issuing commissions to subadmins.
- **prompts/subadmin-ticket-commission.md**: Prompts and guidelines for handling commission-related queries.
- **prompts/examples.md**: Example scenarios for interacting with the agent regarding ticket purchases and commissions.
- **scripts/setup.sh**: Shell script for automating the setup process.
- **templates/agent-config.md**: Template for configuring the agent with necessary fields.

## Setup Instructions
1. Clone the repository:
   ```
   git clone <repository-url>
   cd agent-customization-project
   ```

2. Run the setup script to configure the environment:
   ```
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

3. Review the `.agent.md` file to understand the agent's configuration and functionality.

## Usage Guidelines
- Interact with the agent using the prompts defined in `prompts/subadmin-ticket-commission.md` for commission-related queries.
- Refer to `prompts/examples.md` for example interactions to better understand how to utilize the agent effectively.

## Contribution
Contributions are welcome! Please submit a pull request with your changes and ensure that they adhere to the project's guidelines.

## License
This project is licensed under the MIT License. See the LICENSE file for more details.