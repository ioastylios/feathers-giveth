# Feathers Giveth for RSK
Note: use `rsk` branch for contributing!

### Install
See README.md for general instructions.
Using these instructions you can keep switching back between RSK and the Ethereum bridge feathers.


### Runs serve

1.  Configure RSK
    The configuration file for rsk is located in `/config/rsk.json`

2.  Deploy contracts
    ```
    yarn deploy-local:rsk
    ```

    After deploying local, make sure to copy-paste the MiniMeToken address in `rsk.json`

3.  Start mongo in background
    ```
    mongod --fork --syslog
    ```

4.  Start ganache-cli instances.
  
    ``` 
    yarn start:rskNetwork:debug
    ```

5.  Optionally open a new terminal window and start the ipfs daemon

    ```
    ipfs daemon
    ```
    
6.  Open another terminal, start feathers in rsk mode

    ```
    yarn start:rsk
    ```